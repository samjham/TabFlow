/**
 * Content script that tracks and restores scroll position for every page.
 *
 * Runs at document_start so it can disable the browser's native scroll
 * restoration as early as possible.
 *
 * CAPTURE: Listens for scroll events (debounced 2s) and visibilitychange
 * (tab losing focus). Sends {scrollX, scrollY} to the service worker.
 *
 * RESTORE: Restores scroll position in two scenarios:
 *   1. On page load — asks service worker for saved position (checks Supabase)
 *   2. On tab re-activation — if tab was hidden for >3s, re-checks for a
 *      fresher cross-device position and updates if changed.
 */

// ── Disable native scroll restoration ───────────────────────────────
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

// ── State ───────────────────────────────────────────────────────────

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let restoreActive = false;
let restoreTargetX = 0;
let restoreTargetY = 0;
let userTookOver = false;
let hiddenSince = 0;           // timestamp when tab was last hidden
let lastKnownScrollY = 0;      // our last scrollTo target or user's position

// ── CAPTURE ──────────────────────────────────────────────────────────

function sendScrollPosition() {
  if (restoreActive) return;
  try {
    chrome.runtime.sendMessage({
      type: 'SAVE_SCROLL_POSITION',
      payload: {
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
      },
    }).catch(() => {});
  } catch {}
}

function onScroll() {
  if (restoreActive) {
    // During restore: fight back against browser scroll restoration
    if (!userTookOver) {
      const dy = Math.abs(Math.round(window.scrollY) - restoreTargetY);
      if (dy > 2) {
        window.scrollTo(restoreTargetX, restoreTargetY);
      }
    }
    return;
  }
  lastKnownScrollY = Math.round(window.scrollY);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sendScrollPosition, 2000);
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    // Tab losing focus — flush scroll position immediately
    hiddenSince = Date.now();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    sendScrollPosition();
  } else if (document.visibilityState === 'visible') {
    // Tab becoming visible — if hidden for >3s, check for cross-device
    // scroll update. This handles the case where the user scrolled on
    // another device and switched back to this browser.
    const hiddenDuration = hiddenSince > 0 ? Date.now() - hiddenSince : 0;
    if (hiddenDuration > 3000) {
      checkForRemoteScroll();
    }
  }
}

window.addEventListener('scroll', onScroll, { passive: true });
document.addEventListener('visibilitychange', onVisibilityChange);
window.addEventListener('beforeunload', sendScrollPosition);

// ── User input detection ────────────────────────────────────────────

function onUserInput() {
  if (restoreActive) {
    userTookOver = true;
    restoreActive = false;
  }
}

window.addEventListener('wheel', onUserInput, { passive: true });
window.addEventListener('touchstart', onUserInput, { passive: true });
window.addEventListener('keydown', (e) => {
  const scrollKeys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
  if (restoreActive && scrollKeys.includes(e.key)) {
    onUserInput();
  }
}, { passive: true });

// ── RESTORE (page load) ─────────────────────────────────────────────

function doRestore(targetX: number, targetY: number) {
  restoreTargetX = targetX;
  restoreTargetY = targetY;
  restoreActive = true;
  userTookOver = false;
  lastKnownScrollY = targetY;

  window.scrollTo(targetX, targetY);

  // Retry with increasing delays for lazy-loaded content
  const timers = [150, 400, 800, 1500, 2500, 4000, 6000];
  for (const ms of timers) {
    setTimeout(() => {
      if (!restoreActive || userTookOver) return;
      window.scrollTo(targetX, targetY);
    }, ms);
  }

  // Release control after 7 seconds
  setTimeout(() => { restoreActive = false; }, 7000);
}

function restoreScrollPosition() {
  try {
    chrome.runtime.sendMessage(
      { type: 'GET_SCROLL_POSITION' },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.scrollX != null && response?.scrollY != null) {
          const targetX = response.scrollX;
          const targetY = response.scrollY;
          if (targetX === 0 && targetY === 0) return;
          doRestore(targetX, targetY);
        }
      }
    );
  } catch {}
}

// ── RESTORE (tab re-activation) ─────────────────────────────────────
// When the tab becomes visible after being hidden for a while, check
// if another device pushed a newer scroll position.

function checkForRemoteScroll() {
  try {
    chrome.runtime.sendMessage(
      { type: 'GET_SCROLL_POSITION' },
      (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.scrollX != null && response?.scrollY != null) {
          const remoteY = response.scrollY;
          const remoteX = response.scrollX;
          // Only update if the remote value is meaningfully different
          // from where we currently are
          const currentY = Math.round(window.scrollY);
          if (Math.abs(remoteY - currentY) > 50) {
            doRestore(remoteX, remoteY);
          }
        }
      }
    );
  } catch {}
}

// ── Initial load ────────────────────────────────────────────────────

if (document.readyState === 'complete') {
  restoreScrollPosition();
} else {
  window.addEventListener('load', restoreScrollPosition, { once: true });
}
