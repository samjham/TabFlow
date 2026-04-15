/**
 * Cross-browser compatibility shim.
 *
 * TabFlow targets both Chrome and Firefox (and could be extended to Edge
 * trivially since Edge is Chromium). This module centralizes the small
 * set of runtime differences between the two.
 *
 * Key facts:
 * - Firefox exposes a `chrome` global as an alias for its `browser` global,
 *   so `chrome.tabs.query(...)` etc. work on Firefox. This means most code
 *   in the codebase doesn't need to change at all.
 * - A few APIs only exist on Chrome (`chrome.sidePanel`, `chrome.system.memory`).
 *   The service worker already guards these with optional-chaining / feature
 *   checks, so no change needed — they just become no-ops on Firefox.
 * - Firefox has its own `browser.sidebarAction` API that Chrome doesn't have.
 *   This shim exposes it as `browserCompat.sidebar` for UI code that wants
 *   to open the sidebar programmatically.
 * - The build target is injected by Vite via `import.meta.env.TARGET_BROWSER`
 *   (see vite.config.ts `define`).
 */

/** Build-time target — 'chrome' or 'firefox'. */
export const BROWSER: 'chrome' | 'firefox' =
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — injected by Vite's define() at build time
  (import.meta.env?.TARGET_BROWSER as 'chrome' | 'firefox') ?? 'chrome';

export const isFirefox = BROWSER === 'firefox';
export const isChrome = BROWSER === 'chrome';

/**
 * Runtime detection — useful when the build-time flag is unavailable
 * (e.g. in tests). Falls back to sniffing the global namespace.
 */
export function detectBrowser(): 'chrome' | 'firefox' | 'unknown' {
  if (typeof globalThis === 'undefined') return 'unknown';
  const g = globalThis as any;
  // Firefox exposes `browser` with a real Promise-based API; Chrome does not.
  if (typeof g.browser !== 'undefined' && typeof g.browser.runtime?.getBrowserInfo === 'function') {
    return 'firefox';
  }
  if (typeof g.chrome !== 'undefined') return 'chrome';
  return 'unknown';
}

/**
 * The sidebar API differs:
 * - Chrome: `chrome.sidePanel.open({ tabId })`
 * - Firefox: `browser.sidebarAction.open()`
 *
 * This wrapper picks the right one based on what's available at runtime.
 */
/**
 * Returns the correct base URL prefix for this extension.
 * Chrome: `chrome-extension://<id>/`
 * Firefox: `moz-extension://<id>/`
 *
 * Use this instead of hardcoding `chrome-extension://`.
 */
export function getExtensionBaseUrl(): string {
  return chrome.runtime.getURL('');
}

/**
 * Returns the full URL for an extension page (e.g. 'newtab.html').
 */
export function getExtensionPageUrl(page: string): string {
  return chrome.runtime.getURL(page);
}

export const browserCompat = {
  async openSidebar(tabId?: number): Promise<void> {
    const anyChrome = chrome as any;
    if (anyChrome.sidePanel?.open) {
      try {
        await anyChrome.sidePanel.open({ tabId });
        return;
      } catch {
        /* fall through */
      }
    }
    const anyBrowser = (globalThis as any).browser;
    if (anyBrowser?.sidebarAction?.open) {
      await anyBrowser.sidebarAction.open();
      return;
    }
    // Neither API available — no-op.
  },
};
