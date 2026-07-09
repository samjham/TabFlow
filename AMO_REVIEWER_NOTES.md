# AMO Reviewer Notes for TabFlow 0.1.43

Copy/paste the text below into the "Notes for Reviewers" field when submitting on AMO.

---

TabFlow is an MV3 tab/workspace manager. This release uses four content scripts on `<all_urls>`. Each has a narrow, specific purpose and only communicates with the extension's own service worker. No external network calls are made from any content script. The extension is end-to-end encrypted (AES-GCM via WebCrypto) — the user's self-hosted Supabase project receives only opaque ciphertext.

Content scripts and their purpose:

1. `youtube-time-tracker.js` (matches `*://www.youtube.com/*` only). Reads `document.location` and updates the URL via `history.replaceState` so the YouTube video timestamp (`&t=N` parameter) is reflected in the tab URL. Lets users resume a YouTube video at the correct timestamp after a workspace switch or device switch. No reads or writes outside the YouTube page.

2. `scroll-tracker.js` (matches `<all_urls>`, runs at `document_start`). Captures the page's scroll position on `scroll` (debounced 2s), `visibilitychange`, and `beforeunload`. Sends `SAVE_SCROLL_POSITION` to the service worker which encrypts and stores it. On page load and tab re-activation, requests `GET_SCROLL_POSITION` and restores via `window.scrollTo`. This implements cross-device scroll restoration — open the same tab on another signed-in device, scroll position follows.

3. `operation-overlay.js` (matches `<all_urls>`, runs at `document_start`). Polls the service worker every 250ms via `GET_OPERATION_STATUS`. When the SW reports an in-progress system operation (workspace switch, history restore, etc.), the script injects a full-screen visual overlay with a spinner so the user knows TabFlow is mid-transition. Removes the overlay when the operation completes. Adds no other DOM changes; reads no page content; no network access.

4. `pip-tracker.js` (matches `<all_urls>`, runs at `document_idle`). Listens for the HTML5 Picture-in-Picture lifecycle events (`enterpictureinpicture`, `leavepictureinpicture`) on `<video>` elements (including dynamically-added ones via MutationObserver). Reports state changes to the service worker via `PIP_STATE_CHANGED`. Allows TabFlow to detect when a tab has active PIP so that switching workspaces can preserve the tab (move to hidden window) instead of closing it, which would kill the PIP video. Also responds to `QUERY_PIP_STATE` synchronously with the current `document.pictureInPictureElement` state.

Permissions justifications:

- `<all_urls>` host permission: required because three of the four content scripts must run on any page the user opens (scroll tracking, PIP detection, operation overlay).
- `tabs`: to enumerate, move, and create tabs as part of workspace switching.
- `storage`: local IndexedDB for tab/workspace cache and chrome.storage.local/session for device-local state.
- `nativeMessaging`: optional companion host (Windows-only) for hiding minimized workspace windows from the taskbar via WS_EX_TOOLWINDOW. Functionality degrades gracefully if not installed.
- `alarms`: for periodic pruning of old workspace history entries.
- `sidePanel` (Chrome only): optional sidebar UI. Not present in the Firefox manifest.
- `system.memory` (Chrome only): displays browser memory usage in the TabFlow header. Not present in the Firefox manifest.

No remote scripts are loaded. No telemetry. No analytics. No advertising. The only network destinations the extension reaches are (a) the user's self-hosted Supabase project (URL provided by the user in setup), and (b) standard favicon/page resources via normal browser tab navigation.

Source code is provided. The build is done via Vite (`npm run build:firefox`); see `BUILD_FROM_SOURCE.md` at the repository root for reviewer-facing build steps.

If any specific code or pattern raises a concern, please leave a note and I'll respond promptly.

Thanks for the review.
