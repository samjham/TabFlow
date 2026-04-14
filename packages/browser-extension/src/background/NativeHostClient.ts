/**
 * NativeHostClient — Communicates with the TabFlow native messaging host.
 *
 * The native host hides/shows Chrome windows from the Windows taskbar
 * using the WS_EX_TOOLWINDOW Windows API style.
 *
 * Uses a persistent connection (chrome.runtime.connectNative) so the host
 * stays running and responds instantly to hide/show requests.
 */

const HOST_NAME = 'com.tabflow.host';

/** Message sent to the native host */
interface NativeMessage {
  action: 'hide' | 'show' | 'hideByPid' | 'hideMinimized' | 'ping';
  windowTitle?: string;
  excludeTitle?: string;
}

/** Response from the native host */
interface NativeResponse {
  success: boolean;
  action?: string;
  hwnd?: string;
  hiddenCount?: number;
  error?: string;
}

/**
 * Manages the persistent connection to the TabFlow native messaging host.
 * Reconnects automatically if the connection drops.
 */
export class NativeHostClient {
  private port: chrome.runtime.Port | null = null;
  private connected = false;
  private pendingCallbacks: Map<number, (response: NativeResponse) => void> = new Map();
  private messageId = 0;

  /**
   * Establishes a connection to the native host.
   * Safe to call multiple times — will reuse existing connection.
   */
  connect(): void {
    if (this.connected && this.port) return;

    try {
      this.port = chrome.runtime.connectNative(HOST_NAME);

      this.port.onMessage.addListener((response: NativeResponse) => {
        // Resolve the oldest pending callback (FIFO order)
        const iterator = this.pendingCallbacks.entries().next();
        if (!iterator.done) {
          const [id, callback] = iterator.value;
          this.pendingCallbacks.delete(id);
          callback(response);
        }
      });

      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError?.message || 'disconnected';
        console.warn(`[TabFlow] Native host disconnected: ${error}`);
        this.connected = false;
        this.port = null;

        // Reject any pending callbacks
        for (const [id, callback] of this.pendingCallbacks) {
          callback({ success: false, error: `Host disconnected: ${error}` });
        }
        this.pendingCallbacks.clear();
      });

      this.connected = true;
      console.log('[TabFlow] Connected to native host');
    } catch (error) {
      console.warn('[TabFlow] Failed to connect to native host:', error);
      this.connected = false;
      this.port = null;
    }
  }

  /**
   * Sends a message to the native host and returns the response.
   * Automatically connects if not already connected.
   */
  private async sendMessage(message: NativeMessage): Promise<NativeResponse> {
    if (!this.connected || !this.port) {
      this.connect();
    }

    if (!this.connected || !this.port) {
      return { success: false, error: 'Native host not available' };
    }

    return new Promise<NativeResponse>((resolve) => {
      const id = ++this.messageId;

      // Timeout after 5 seconds
      const timeout = setTimeout(() => {
        this.pendingCallbacks.delete(id);
        resolve({ success: false, error: 'Native host timeout' });
      }, 5000);

      this.pendingCallbacks.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });

      this.port!.postMessage(message);
    });
  }

  /**
   * Checks if the native host is available and responsive.
   */
  async ping(): Promise<boolean> {
    const response = await this.sendMessage({ action: 'ping' });
    return response.success;
  }

  /**
   * Checks if the native host is connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Hides a Chrome window from the taskbar by its title.
   * The window must contain the given title substring.
   */
  async hideWindow(windowTitle: string): Promise<boolean> {
    const response = await this.sendMessage({
      action: 'hide',
      windowTitle,
    });

    if (response.success) {
      console.log(`[TabFlow] Hidden window from taskbar: "${windowTitle}"`);
    } else {
      console.warn(`[TabFlow] Failed to hide window: ${response.error}`);
    }

    return response.success;
  }

  /**
   * Restores a Chrome window to the taskbar by its title.
   */
  async showWindow(windowTitle: string): Promise<boolean> {
    const response = await this.sendMessage({
      action: 'show',
      windowTitle,
    });

    if (response.success) {
      console.log(`[TabFlow] Restored window to taskbar: "${windowTitle}"`);
    } else {
      console.warn(`[TabFlow] Failed to show window: ${response.error}`);
    }

    return response.success;
  }

  /**
   * Hides all Chrome windows from the taskbar EXCEPT the one
   * whose title contains the given substring.
   * Useful after creating a hidden window to batch-hide everything
   * except the main TabFlow window.
   */
  async hideAllExcept(excludeTitle: string): Promise<number> {
    const response = await this.sendMessage({
      action: 'hideByPid',
      excludeTitle,
    });

    if (response.success) {
      console.log(`[TabFlow] Hidden ${response.hiddenCount} windows from taskbar`);
      return response.hiddenCount || 0;
    } else {
      console.warn(`[TabFlow] Failed to hide windows: ${response.error}`);
      return 0;
    }
  }

  /**
   * Hides all MINIMIZED Chrome windows from the taskbar.
   * This is the safest approach — only minimized windows (TabFlow's
   * hidden workspace windows) are affected. The user's main Chrome
   * window is never touched because it's not minimized.
   */
  async hideMinimized(): Promise<number> {
    const response = await this.sendMessage({
      action: 'hideMinimized',
    });

    if (response.success) {
      console.log(`[TabFlow] Hidden ${response.hiddenCount} minimized windows from taskbar`);
      return response.hiddenCount || 0;
    } else {
      console.warn(`[TabFlow] Failed to hide minimized windows: ${response.error}`);
      return 0;
    }
  }

  /**
   * Disconnects from the native host.
   */
  disconnect(): void {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
      this.connected = false;
    }
  }
}
