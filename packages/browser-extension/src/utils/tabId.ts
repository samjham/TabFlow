/**
 * Deterministic tab ID generation for cross-browser sync.
 *
 * Background: Before this module, tab storage IDs were generated as
 * `chrome-<numericId>` where numericId came from Chrome's `chrome.tabs` API.
 * Chrome and Firefox each maintain independent tab-ID counters starting
 * from 1, which meant unrelated tabs in each browser could collide on the
 * same storage ID — Firefox's gmail tab at `chrome-1234` would overwrite
 * Chrome's github tab at `chrome-1234` in Supabase. See §9 of CLAUDE.md
 * for the full incident writeup.
 *
 * Fix: IDs are now derived deterministically from the tab's content —
 * specifically `SHA-256(workspaceId|canonicalUrl|firstSeenAtISO)` truncated
 * to 16 hex chars. This means:
 *
 * - Same URL in same workspace with same firstSeenAt → same ID (idempotent
 *   upserts across browsers).
 * - Duplicate URLs within a workspace can coexist — each has its own
 *   `firstSeenAt`, so each gets a distinct ID that stays stable forever.
 * - Snapshot logic can reuse existing IDs by matching on canonicalized URL
 *   and consuming unmatched records in createdAt order, so reorders don't
 *   churn IDs.
 *
 * URL canonicalization is lenient (trailing-slash + host-case only) to avoid
 * splitting what the user perceives as "the same tab" when the browser
 * reports it slightly differently across sessions.
 */

/**
 * Canonicalizes a URL for the purpose of matching snapshot tabs to existing
 * records. Strips a trailing slash from the path and lowercases the host.
 * Query params, fragments, port, and scheme are preserved as-is because
 * they represent genuine content differences (e.g. `?v=xyz` on YouTube).
 *
 * Non-parseable URLs (chrome://, about:, etc.) are returned unchanged —
 * those are handled by the exclusion filters upstream, and we don't want
 * to silently mangle them here.
 */
export function canonicalizeUrl(url: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    // Lowercase host (case-insensitive per RFC 3986)
    u.hostname = u.hostname.toLowerCase();
    // Strip exactly one trailing slash from the path, but never from the
    // root path itself (`/` stays as `/` because `new URL('https://x')`
    // round-trips through `https://x/` and stripping would produce an
    // invalid URL).
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    // Not a URL we can parse — return as-is.
    return url;
  }
}

/**
 * Converts an ArrayBuffer of bytes into a lowercase hex string.
 */
function bytesToHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    const b = view[i];
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/**
 * Computes the deterministic storage ID for a tab.
 *
 * Formula: `tab-` + first 16 hex chars of SHA-256 over
 * `workspaceId + "|" + canonicalizeUrl(url) + "|" + firstSeenAt.toISOString()`.
 *
 * 16 hex chars = 64 bits of entropy. With the expected scale (low thousands
 * of tabs per user), collision risk is negligible and the IDs are short
 * enough to read in logs.
 *
 * The separator `|` is chosen because it's unlikely to appear in workspace
 * IDs (UUIDs) or URLs without being percent-encoded, which keeps the three
 * fields unambiguously separable. Even if it did appear, the hash still
 * uniquely identifies the input triple — we'd just lose the theoretical
 * guarantee that two different triples never hash the same input string.
 */
export async function computeTabId(
  workspaceId: string,
  url: string,
  firstSeenAt: Date
): Promise<string> {
  const canonical = canonicalizeUrl(url);
  const payload = `${workspaceId}|${canonical}|${firstSeenAt.toISOString()}`;
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = bytesToHex(digest);
  return `tab-${hex.slice(0, 16)}`;
}

/**
 * True if the given ID looks like a legacy (non-deterministic) storage ID.
 * Migration uses this to decide which records to rewrite.
 */
export function isLegacyTabId(id: string): boolean {
  if (!id) return false;
  return (
    id.startsWith('chrome-') ||
    id.startsWith('restart-') ||
    id.startsWith('moved-') ||
    id.startsWith('dup-')
  );
}
