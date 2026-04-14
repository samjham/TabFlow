/**
 * Supabase Configuration for TabFlow Chrome Extension
 *
 * Credentials are read from chrome.storage.local (set during onboarding).
 * Falls back to hardcoded defaults for the developer's own Supabase project.
 *
 * @remarks
 * - SUPABASE_URL: Your Supabase project URL (e.g., https://xxxxx.supabase.co)
 * - SUPABASE_ANON_KEY: The anonymous/public key for client-side access
 */

/** Default (developer) Supabase credentials — used as fallback */
const DEFAULT_SUPABASE_URL = 'https://vsfzjtintbkrkyfajjlx.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_bUFeI_1R3uodj19GN57-xw_gARgQveK';

/** Cached values so we only read from storage once per session */
let cachedUrl: string | null = null;
let cachedKey: string | null = null;

/**
 * Returns the Supabase URL and anon key.
 * Reads from chrome.storage.local first (user-configured during onboarding),
 * then falls back to the hardcoded developer defaults.
 */
export async function getSupabaseConfig(): Promise<{ url: string; anonKey: string }> {
  if (cachedUrl && cachedKey) {
    return { url: cachedUrl, anonKey: cachedKey };
  }

  try {
    const stored = await chrome.storage.local.get(['supabaseUrl', 'supabaseAnonKey']);
    cachedUrl = stored.supabaseUrl || DEFAULT_SUPABASE_URL;
    cachedKey = stored.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;
  } catch {
    cachedUrl = DEFAULT_SUPABASE_URL;
    cachedKey = DEFAULT_SUPABASE_ANON_KEY;
  }

  return { url: cachedUrl, anonKey: cachedKey };
}

/**
 * Checks whether the user has a working Supabase connection.
 * Returns true if:
 *   - Custom credentials are stored in chrome.storage.local, OR
 *   - The user already has an auth session (meaning the hardcoded defaults work)
 */
export async function isSupabaseConfigured(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(['supabaseUrl', 'supabaseAnonKey']);
    if (stored.supabaseUrl && stored.supabaseAnonKey) return true;

    // Check if there's an existing Supabase auth session — if so, the
    // hardcoded defaults are working and we don't need to show the wizard.
    // Auth tokens are stored in chrome.storage.local with a key like
    // 'sb-<ref>-auth-token'. Look for any key matching that pattern.
    const allKeys = await chrome.storage.local.get(null);
    for (const key of Object.keys(allKeys)) {
      if (key.includes('-auth-token')) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Checks whether the user chose to skip cloud sync (local-only mode).
 */
export async function isLocalOnlyMode(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get('tabflow_local_only');
    return !!stored.tabflow_local_only;
  } catch {
    return false;
  }
}

/**
 * Saves Supabase credentials to chrome.storage.local.
 * Called by the onboarding wizard after the user enters their project details.
 */
export async function saveSupabaseConfig(url: string, anonKey: string): Promise<void> {
  await chrome.storage.local.set({ supabaseUrl: url, supabaseAnonKey: anonKey });
  // Update cached values
  cachedUrl = url;
  cachedKey = anonKey;
}

/**
 * Clears cached config (useful after sign-out or config reset).
 */
export function clearConfigCache(): void {
  cachedUrl = null;
  cachedKey = null;
}

// Legacy exports for backward compatibility (synchronous access)
// These use the defaults and should be phased out in favor of getSupabaseConfig()
export const SUPABASE_URL = DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = DEFAULT_SUPABASE_ANON_KEY;
