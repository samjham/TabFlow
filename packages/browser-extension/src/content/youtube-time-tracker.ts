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
 *
 * 0.1.54: Added flush-on-hide handlers. Firefox throttles setInterval on
 * hidden tabs (and stops JS entirely when a tab is hidden via
 * chrome.tabs.hide() for TabFlow's persistent-tab preservation). Without
 * flushing on visibilitychange/pagehide/PIP-enter, the URL sync stays
 * stuck at whatever the last periodic write was — meaning cross-device
 * sync of an in-progress video would leave the "resume at" position
 * minutes behind the actual PIP playback position. Now, the moment the
 * tab loses visibility (or PIP starts), we flush currentTime to the URL
 * immediately, so Supabase always has the latest known position.
 */

(function () {
  // How often to update the URL (in milliseconds).
  // 10 seconds is frequent enough to minimize lost progress without
  // being noisy. YouTube's own `t` parameter uses whole seconds.
  const UPDATE_INTERVAL_MS = 10_000;
  // Minimum position delta (seconds) for periodic writes. Ignored by
  // forced flushes (visibilitychange/pagehide/PIP-enter) which always
  // write regardless of delta.
  const MIN_DELTA_S = 5;

  let intervalId: ReturnType<typeof setInterval> | null = null;

  function updateTimestamp(force = false) {
    // Only act on watch pages
    if (!window.location.pathname.startsWith('/watch')) return;

    const video = document.querySelector('video');
    if (!video) return;

    // Skip if video hasn't started or is paused (unless forced, in
    // which case we still write whatever position the video is at so
    // the last-visible timestamp is captured)
    if (!force && (video.paused || video.currentTime < 1)) return;
    if (video.currentTime < 1) return;

    // Skip live streams (duration is Infinity)
    if (!isFinite(video.duration)) return;

    const currentSeconds = Math.floor(video.currentTime);

    // Build the updated URL with the new `t` parameter
    const url = new URL(window.location.href);
    const existingT = url.searchParams.get('t');
    const existingSeconds = existingT
      ? parseInt(existingT.replace('s', ''), 10)
      : 0;

    // Only skip the periodic 5-second min-delta check when not forced.
    // Forced flushes (visibility loss / PIP enter) always write so the
    // sync captures the exact position at the transition point.
    if (!force && Math.abs(currentSeconds - existingSeconds) < MIN_DELTA_S) return;

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
    intervalId = setInterval(() => updateTimestamp(false), UPDATE_INTERVAL_MS);
    // Also run once immediately (e.g., user navigated to a new video)
    setTimeout(() => updateTimestamp(false), 2000);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  // 0.1.54: Flush on any transition to hidden. This covers:
  //   - user switches to another Firefox tab
  //   - user Alt-Tabs out of Firefox
  //   - TabFlow calls chrome.tabs.hide() during workspace switch
  // The visibilitychange event fires BEFORE Firefox's throttling of
  // background JS kicks in, so we get one clean write of the current
  // playback position before the setInterval starts running slowly (or
  // stops entirely, in the .hide() case).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      updateTimestamp(true);
    }
  });

  // 0.1.54: Also flush on pagehide (fires when the page is being
  // navigated away from or the tab is being closed). Belt-and-suspenders
  // for the case where visibilitychange didn't cover it.
  window.addEventListener('pagehide', () => {
    updateTimestamp(true);
  });

  // 0.1.54: Flush the moment PIP starts. In practice the user typically
  // clicks PIP THEN switches workspaces (a few seconds apart). Writing
  // on PIP entry captures the position at the "I'm starting a PIP
  // session" moment, so even if the visibilitychange path somehow
  // misses (e.g., user hits Alt-Tab within milliseconds), the position
  // is already written.
  document.addEventListener('enterpictureinpicture', () => {
    updateTimestamp(true);
  }, true);

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
