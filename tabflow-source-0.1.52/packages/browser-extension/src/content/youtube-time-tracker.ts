/**
 * YouTube Video Time Tracker — Content Script
 *
 * Periodically updates the page URL's `t` parameter to reflect the
 * current video playback position. Uses history.replaceState so there's
 * no page reload — the URL just silently updates in Chrome's tab info.
 *
 * This means TabFlow's snapshot system (which reads tab URLs via
 * chrome.tabs.query) automatically captures the correct timestamp.
 * On Chrome restart, the restored tab URL will resume near where
 * the user left off.
 *
 * Only runs on youtube.com/watch pages. Does nothing if the video
 * is paused or hasn't started yet.
 */

(function () {
  // How often to update the URL (in milliseconds).
  // 10 seconds is frequent enough to minimize lost progress without
  // being noisy. YouTube's own `t` parameter uses whole seconds.
  const UPDATE_INTERVAL_MS = 10_000;

  let intervalId: ReturnType<typeof setInterval> | null = null;

  function updateTimestamp() {
    // Only act on watch pages
    if (!window.location.pathname.startsWith('/watch')) return;

    const video = document.querySelector('video');
    if (!video) return;

    // Skip if video hasn't started or is paused
    if (video.paused || video.currentTime < 1) return;

    // Skip live streams (duration is Infinity)
    if (!isFinite(video.duration)) return;

    const currentSeconds = Math.floor(video.currentTime);

    // Build the updated URL with the new `t` parameter
    const url = new URL(window.location.href);
    const existingT = url.searchParams.get('t');
    const existingSeconds = existingT
      ? parseInt(existingT.replace('s', ''), 10)
      : 0;

    // Only update if the position has moved meaningfully (≥5 seconds)
    // to avoid unnecessary replaceState calls
    if (Math.abs(currentSeconds - existingSeconds) < 5) return;

    url.searchParams.set('t', `${currentSeconds}s`);

    // Update the URL without reloading the page.
    // This makes chrome.tabs.query() return the updated URL.
    try {
      history.replaceState(history.state, '', url.href);
    } catch {
      // SecurityError or other issue — silently ignore
    }
  }

  function start() {
    if (intervalId) return;
    intervalId = setInterval(updateTimestamp, UPDATE_INTERVAL_MS);
    // Also run once immediately (e.g., user navigated to a new video)
    setTimeout(updateTimestamp, 2000);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  // YouTube is a SPA — the user navigates between pages without full
  // page reloads. Listen for YouTube's own navigation events to
  // start/stop tracking as appropriate.
  document.addEventListener('yt-navigate-finish', () => {
    if (window.location.pathname.startsWith('/watch')) {
      start();
    } else {
      stop();
    }
  });

  // Initial start if we're already on a watch page
  if (window.location.pathname.startsWith('/watch')) {
    start();
  }
})();
