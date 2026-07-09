/**
 * HiddenTabsMap — device-local, session-local tracker of tabs the user
 * marked as `persistent` that we have currently hidden (via Firefox's
 * `chrome.tabs.hide()` API) instead of closed.
 *
 * Shipped in 0.1.46 as part of the user-controlled tab-preservation feature.
 *
 * Mental model:
 *   - When the user switches AWAY from a workspace, any outgoing tab whose
 *     storage record has `persistent: true` gets `chrome.tabs.hide()`d and
 *     an entry `{ [storageId]: chromeTabId }` is added to this map.
 *   - When the user switches BACK to that workspace, the incoming code
 *     path checks the map first — if the entry exists AND the Chrome tab
 *     still exists (verified via `chrome.tabs.get`), we call
 *     `chrome.tabs.show()` instead of creating a fresh tab.
 *   - Session storage means the map resets on browser restart, matching
 *     PIP's own lifecycle — the whole point of this feature is to preserve
 *     things that die on browser close anyway.
 *   - Device-local — never syncs. Only the `persistent` flag itself syncs.
 *
 * Persisted in `chrome.storage.session` because it's cheap, survives SW
 * sleep/wake cycles within a browser session, but is cleared on real
 * browser restart. This mirrors how 0.1.40's `pipActiveTabs` handles state
 * that shouldn't outlive the session.
 */

const STORAGE_KEY = 'tabflow_hidden_tabs';

/** Read the full map. Returns {} when nothing is stored yet. */
export async function getHiddenTabsMap(): Promise<Record<string, number>> {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    const val = stored?.[STORAGE_KEY];
    if (val && typeof val === 'object') return val as Record<string, number>;
  } catch (err) {
    console.warn('[TabFlow] getHiddenTabsMap failed:', err);
  }
  return {};
}

/** Add or update one entry (storageId -> chromeTabId). */
export async function setHiddenTab(storageId: string, chromeTabId: number): Promise<void> {
  try {
    const map = await getHiddenTabsMap();
    map[storageId] = chromeTabId;
    await chrome.storage.session.set({ [STORAGE_KEY]: map });
  } catch (err) {
    console.warn('[TabFlow] setHiddenTab failed:', err);
  }
}

/** Remove one entry by storage ID. No-op if not present. */
export async function clearHiddenTab(storageId: string): Promise<void> {
  try {
    const map = await getHiddenTabsMap();
    if (!(storageId in map)) return;
    delete map[storageId];
    await chrome.storage.session.set({ [STORAGE_KEY]: map });
  } catch (err) {
    console.warn('[TabFlow] clearHiddenTab failed:', err);
  }
}

/** Remove entry(entries) by chromeTabId. Called from tabs.onRemoved. */
export async function clearHiddenTabByChromeId(chromeTabId: number): Promise<string[]> {
  const removed: string[] = [];
  try {
    const map = await getHiddenTabsMap();
    let changed = false;
    for (const [storageId, id] of Object.entries(map)) {
      if (id === chromeTabId) {
        delete map[storageId];
        removed.push(storageId);
        changed = true;
      }
    }
    if (changed) {
      await chrome.storage.session.set({ [STORAGE_KEY]: map });
    }
  } catch (err) {
    console.warn('[TabFlow] clearHiddenTabByChromeId failed:', err);
  }
  return removed;
}

/**
 * Walk the map and drop entries whose Chrome tab no longer exists.
 * Called on SW startup and periodically as a safety net. Returns the list
 * of storageIds that were pruned (caller may want to log them via
 * `logDiagnostic('cleanup', ...)`).
 */
export async function pruneStaleHiddenTabs(): Promise<string[]> {
  const pruned: string[] = [];
  try {
    const map = await getHiddenTabsMap();
    const entries = Object.entries(map);
    if (entries.length === 0) return [];

    for (const [storageId, chromeTabId] of entries) {
      let alive = false;
      try {
        const t = await chrome.tabs.get(chromeTabId);
        alive = !!t;
      } catch {
        alive = false;
      }
      if (!alive) {
        delete map[storageId];
        pruned.push(storageId);
      }
    }
    if (pruned.length > 0) {
      await chrome.storage.session.set({ [STORAGE_KEY]: map });
    }
  } catch (err) {
    console.warn('[TabFlow] pruneStaleHiddenTabs failed:', err);
  }
  return pruned;
}
