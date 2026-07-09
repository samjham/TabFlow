/**
 * Operation overlay content script.
 *
 * Shown on every page (except TabFlow's own pages) while a TabFlow system
 * operation is in progress. The React-based overlay in NewTab.tsx only
 * covers the TabFlow newtab page — but operations like the thumbnail
 * backfill briefly activate other tabs, so this content script ensures
 * the user always sees a "loading" indicator and can't interact with
 * page content during operations.
 *
 * Mechanism: poll the service worker every 250ms for GET_OPERATION_STATUS.
 * Render an overlay div when an operation is active, remove it when not.
 */

// Skip on TabFlow's own pages — React modal handles those.
const url = window.location.href;
if (!(url.includes('/newtab.html') && (url.startsWith('chrome-extension://') || url.startsWith('moz-extension://')))) {

  const OVERLAY_ID = 'tabflow-operation-overlay';
  const STYLE_ID = 'tabflow-operation-overlay-style';

  function operationLabel(name: string): string {
    switch (name) {
      case 'handleSwitchWorkspace': return 'Switching workspace…';
      case 'handleRestoreHistoryEntry': return 'Restoring from history…';
      case 'claimActiveDeviceWithMaterialization': return 'Loading from cloud…';
      case 'handleMoveTabsInServiceWorker': return 'Moving tabs…';
      case 'startupReconcile': return 'Restoring session…';
      default: return 'Working…';
    }
  }

  function injectKeyframes() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '@keyframes tabflow-overlay-spin { to { transform: rotate(360deg); } }';
    (document.head || document.documentElement).appendChild(style);
  }

  function showOverlay(operationName: string) {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      // Update label if it changed
      const titleEl = overlay.querySelector('[data-tabflow-overlay-title]');
      if (titleEl) titleEl.textContent = operationLabel(operationName);
      return;
    }

    injectKeyframes();

    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      backgroundColor: 'rgba(5, 8, 16, 0.72)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      zIndex: '2147483647',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      backgroundColor: '#1a1d24',
      color: '#e6e6ea',
      padding: '32px 40px',
      borderRadius: '16px',
      boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)',
      maxWidth: '440px',
      textAlign: 'center',
    });

    const spinner = document.createElement('div');
    Object.assign(spinner.style, {
      width: '38px',
      height: '38px',
      border: '3px solid rgba(255, 255, 255, 0.12)',
      borderTopColor: '#6c8cff',
      borderRadius: '50%',
      margin: '0 auto 16px',
      animation: 'tabflow-overlay-spin 800ms linear infinite',
    });
    card.appendChild(spinner);

    const title = document.createElement('div');
    title.setAttribute('data-tabflow-overlay-title', 'true');
    title.textContent = operationLabel(operationName);
    Object.assign(title.style, {
      fontSize: '18px',
      fontWeight: '600',
      marginBottom: '8px',
      letterSpacing: '0.01em',
    });
    card.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Please wait — TabFlow is updating your tabs.';
    Object.assign(subtitle.style, {
      fontSize: '13.5px',
      color: '#94a3b8',
      lineHeight: '1.5',
    });
    card.appendChild(subtitle);

    overlay.appendChild(card);

    const root = document.body || document.documentElement;
    if (root) {
      root.appendChild(overlay);
    }
  }

  function hideOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.remove();
    // Leave the keyframes style — cheap to keep and avoids re-injection thrash.
  }

  async function poll() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_OPERATION_STATUS' });
      if (response?.success && response.data) {
        showOverlay(response.data.operationName);
      } else {
        hideOverlay();
      }
    } catch {
      // Service worker might be reloading or sleeping. Try again on next tick.
      hideOverlay();
    }
  }

  // First poll immediately (in case an operation is already in progress
  // when the page loads — e.g., the operation started before this tab
  // was activated).
  poll();

  // Then poll every 250ms.
  setInterval(poll, 250);
}
