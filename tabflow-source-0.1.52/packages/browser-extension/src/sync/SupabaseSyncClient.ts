/**
 * Supabase Real-time Sync Client for TabFlow Chrome Extension
 *
 * Provides bidirectional synchronization between local IndexedDB storage
 * and Supabase backend with end-to-end encryption.
 *
 * @remarks
 * - Local changes are encrypted and pushed to Supabase
 * - Remote changes from Supabase are decrypted and written to local IndexedDB
 * - Uses Supabase Realtime channels for live updates
 * - All sensitive fields (url, title) are encrypted client-side before transmission
 */

import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { StorageAdapter, Workspace, Tab, WorkspaceHistoryEntry, DeletedWorkspace } from '@tabflow/core';
import {
  encrypt,
  decrypt,
  encryptTab,
  decryptTab,
} from '@tabflow/core/crypto/encryption';

/**
 * Configuration for a Supabase sync event
 */
interface SupabaseSyncEvent {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: 'workspaces' | 'tabs';
  new?: Record<string, any>;
  old?: Record<string, any>;
}

/**
 * Returns true if this URL is safe to sync / import across browsers.
 *
 * Allows:
 *  - http:// and https:// (regular web pages)
 *  - file:// (local files)
 *  - chrome://* and about:* (privileged browser pages — Chrome and Firefox
 *    each refuse to open the OTHER browser's scheme, but the UI renders a
 *    cross-browser badge on those tiles and catches the "Illegal URL"
 *    rejection at click time. Syncing them lets the user have, say,
 *    `chrome://extensions/` and `about:debugging` live as tiles in a shared
 *    "Software Development" workspace.)
 *
 * Rejects:
 *  - `moz-extension://` / `chrome-extension://` (point back at the extension
 *    itself and would loop TabFlow onto its own new-tab page)
 *  - `edge://`, `vivaldi://`, `brave://`, etc. (browser-specific and won't
 *    work on Chrome or Firefox)
 *  - javascript:, data: and other exotic schemes
 */
function isSyncableTabUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  if (url.startsWith('file://')) return true;
  if (url.startsWith('chrome://')) return true;
  if (url.startsWith('about:')) return true;
  return false;
}

/**
 * Returns true if this favicon URL is safe to display / sync.
 *
 * Firefox (and Chrome) sometimes surface browser-internal favicon URLs like
 * `chrome://global/skin/icons/info.svg` which the OTHER browser can't load and
 * will log as "Not allowed to load local resource". Only data-URIs and real
 * http(s) URLs should cross the sync boundary.
 */
function isSyncableFaviconUrl(faviconUrl: string | undefined | null): boolean {
  if (!faviconUrl) return false;
  if (faviconUrl.startsWith('data:')) return true;
  if (faviconUrl.startsWith('http://') || faviconUrl.startsWith('https://')) return true;
  return false;
}

// 0.1.49 instrumentation: dedupe active-device-state logs so we only log
// on transitions, not on every poll.
let lastLoggedActiveState: boolean | null = null;

/**
 * Generates (or retrieves) a stable device ID for this Chrome installation.
 * Stored in chrome.storage.local so it persists across sessions but is
 * unique per browser profile.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const stored = await chrome.storage.local.get('tabflow_device_id');
  if (stored.tabflow_device_id) return stored.tabflow_device_id;

  const id = `device-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await chrome.storage.local.set({ tabflow_device_id: id });
  return id;
}

/**
 * Returns a human-readable name for this device.
 * Uses the user agent to extract browser + OS info.
 * 0.1.52: now browser-aware (was hardcoded to "Chrome on ..." previously).
 */
export function getDeviceName(): string {
  const ua = navigator.userAgent;
  let os = 'Unknown OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('CrOS')) os = 'ChromeOS';
  const isFirefox = ua.includes('Firefox');
  const isChrome = !isFirefox && ua.includes('Chrome');
  const browser = isFirefox ? 'Firefox' : isChrome ? 'Chrome' : 'Browser';
  return `${browser} on ${os}`;
}

/**
 * Real-time sync client using Supabase Realtime and end-to-end encryption
 */
export class SupabaseSyncClient {
  private supabase: SupabaseClient;
  private storage: StorageAdapter;
  private encryptionKey: CryptoKey;
  private userId: string | null = null;
  private workspacesChannel: RealtimeChannel | null = null;
  private tabsChannel: RealtimeChannel | null = null;
  /** Callback invoked when a remote change is applied to local storage */
  private onRemoteChange?: () => void;
  /** Flag to suppress remote change handling while we're pushing local changes */
  private isPushing = false;
  /**
   * Track recently pushed IDs so we can ignore Realtime echoes that arrive
   * after isPushing is already reset to false (async delay).
   */
  private recentlyPushedIds = new Set<string>();
  /**
   * The local user ID used in local storage (e.g. 'local-user').
   * Supabase stores the real auth user ID, but locally we always use this
   * so getWorkspaces('local-user') continues to find records.
   */
  private localUserId: string;

  /** Unique ID for this Chrome installation */
  private deviceId: string | null = null;
  /** Whether this device currently holds the active session */
  private _isActiveDevice = false;
  /** Realtime channel for active_devices table */
  private deviceChannel: RealtimeChannel | null = null;
  /** Heartbeat interval handle */
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  /** Callback when active device status changes */
  private onActiveDeviceChange?: (isActive: boolean, claimedBy?: string) => void;

  // 0.1.49 instrumentation: optional callback for logging sync events into
  // the SW-owned diagnostic buffer. Wired from service-worker.ts; kept as
  // a callback (rather than importing logDiagnostic directly) because
  // SupabaseSyncClient lives in @tabflow/browser-extension/src/sync and
  // shouldn't depend on background-only modules.
  private onDiagnostic?: (category: string, message: string, data?: any) => void;

  // 0.1.50: optional callback fired when a push fails because a required
  // Supabase column is missing (PostgREST schema-cache error). The SW
  // wires this to a chrome.storage.local flag that the UI polls to show
  // a persistent banner with the ALTER TABLE SQL the user needs to run.
  // Also called with column=null to clear the flag when a subsequent
  // push succeeds.
  private onSchemaMissingColumn?: (column: string | null, operation: string) => void;

  /**
   * Creates a new SupabaseSyncClient instance.
   *
   * @param supabase - Authenticated Supabase client
   * @param storage - StorageAdapter instance (typically IndexedDB)
   * @param encryptionKey - CryptoKey for E2E encryption/decryption
   *
   * @example
   * ```ts
   * const client = new SupabaseSyncClient(supabase, storage, encryptionKey);
   * await client.connect(userId);
   * ```
   */
  constructor(
    supabase: SupabaseClient,
    storage: StorageAdapter,
    encryptionKey: CryptoKey,
    localUserId: string,
    onRemoteChange?: () => void,
    onActiveDeviceChange?: (isActive: boolean, claimedBy?: string) => void,
    onDiagnostic?: (category: string, message: string, data?: any) => void,
    onSchemaMissingColumn?: (column: string | null, operation: string) => void
  ) {
    this.supabase = supabase;
    this.storage = storage;
    this.encryptionKey = encryptionKey;
    this.localUserId = localUserId;
    this.onRemoteChange = onRemoteChange;
    this.onActiveDeviceChange = onActiveDeviceChange;
    this.onDiagnostic = onDiagnostic;
    this.onSchemaMissingColumn = onSchemaMissingColumn;
  }

  /**
   * 0.1.49 instrumentation helper. Wraps the optional onDiagnostic
   * callback in a try/catch so logging failures can never break sync.
   */
  private diag(category: string, message: string, data?: any): void {
    try {
      this.onDiagnostic?.(category, message, data);
    } catch {
      // Non-fatal — logging must never break sync
    }
  }

  /**
   * 0.1.50 schema-cache detection. When PostgREST returns an error like
   * "Could not find the 'persistent' column of 'tabs' in the schema cache"
   * we parse the column name out of the message and fire two side channels:
   * (1) logDiagnostic with a dedicated category so the Diagnose report
   * highlights it; (2) chrome.storage.local flag (via onSchemaMissingColumn
   * callback) that the newtab UI polls and turns into a prominent banner
   * telling the user the exact ALTER TABLE SQL to run.
   *
   * Called from every push method's catch block. When a subsequent push
   * of the same operation succeeds, notifySchemaCacheClear(operation) is
   * called to clear the flag.
   */
  private notifySchemaCacheError(errorMessage: string, operation: string): void {
    if (!errorMessage) return;
    // PostgREST typically formats these as:
    //   "Could not find the 'persistent' column of 'tabs' in the schema cache"
    // Sometimes just: "column tabs.persistent does not exist"
    const isSchemaError =
      errorMessage.toLowerCase().includes('schema cache') ||
      (errorMessage.toLowerCase().includes('could not find the') &&
        errorMessage.toLowerCase().includes('column'));
    if (!isSchemaError) return;

    // Try to extract the column name. PostgREST format has it single-quoted.
    let column: string | null = null;
    const singleQuoted = errorMessage.match(/'([^']+)'\s+column/i);
    if (singleQuoted) {
      column = singleQuoted[1];
    } else {
      // Fallback: "column X.Y does not exist"
      const dotted = errorMessage.match(/column\s+\S+\.(\w+)/i);
      if (dotted) column = dotted[1];
    }

    this.diag('error', 'schema-cache-missing-column', {
      column,
      operation,
      error: errorMessage,
    });
    try {
      this.onSchemaMissingColumn?.(column, operation);
    } catch {
      // Non-fatal
    }
  }

  /**
   * Companion to notifySchemaCacheError — clears the persistent flag when
   * a subsequent push of the SAME operation succeeds. Called from the
   * happy path of each push method after a successful response.
   */
  private notifySchemaCacheClear(operation: string): void {
    try {
      this.onSchemaMissingColumn?.(null, operation);
    } catch {
      // Non-fatal
    }
  }

  /**
   * Establishes real-time sync connections for the given user.
   *
   * Sets up Realtime subscriptions for both workspaces and tabs tables,
   * filtered by the user's ID. Incoming changes are automatically decrypted
   * and written to local IndexedDB.
   *
   * @param userId - The ID of the user to sync for
   * @returns Promise that resolves when subscriptions are established
   *
   * @example
   * ```ts
   * await client.connect(user.id);
   * ```
   */
  async connect(userId: string): Promise<void> {
    this.userId = userId;

    // NOTE: Realtime subscriptions for `workspaces` and `tabs` tables are
    // intentionally NOT created. They caused a race condition where the
    // non-active browser wrote the active browser's pushed data into its
    // own IndexedDB before detecting the device-change notification,
    // creating duplicates and cross-workspace tab leaks.
    //
    // All data transfer between browsers now goes through explicit
    // push (snapshotActiveWorkspace) and pull (pullAll on claim) paths.
    //
    // The `active_devices` subscription (in initDeviceSession) is the
    // only realtime channel we need — it triggers the Resume modal.
  }

  // ─── DEVICE SESSION MANAGEMENT ────────────────────────────────────

  /**
   * DEPRECATED for external callers — returns the cached in-memory flag.
   * Kept only because `startHeartbeat`/`stopHeartbeat` and realtime handlers
   * internally read it to decide whether to act. Every external read (UI
   * status, push gates, tab-lock enforcement) must use `isActiveDeviceFromDb()`
   * instead — the database is the single source of truth for device status.
   */
  get isActiveDevice(): boolean {
    return this._isActiveDevice;
  }

  /**
   * Queries the `active_devices` table directly and returns whether THIS
   * device currently holds the claim. No caches, no fallbacks — every call
   * round-trips to Supabase.
   *
   * Side effect: refreshes the internal `_isActiveDevice` flag to match
   * whatever the DB says. This keeps the internal flag useful for the few
   * tight loops (heartbeat, realtime handlers) that can't do async reads
   * without race conditions.
   *
   * Returns `{ isActive: false }` without touching the internal flag when
   * the query fails (network blip, RLS denial, etc.) — callers decide how
   * to treat "unknown".
   */
  async isActiveDeviceFromDb(): Promise<{ isActive: boolean; claimedBy?: string }> {
    if (!this.userId || !this.deviceId) return { isActive: false };

    const { data, error } = await this.supabase
      .from('active_devices')
      .select('device_id, device_name')
      .eq('user_id', this.userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Zero rows — no device has claimed. Technically this device could
        // auto-claim, but that's initDeviceSession's job; here we just
        // report the state.
        this._isActiveDevice = false;
        if (lastLoggedActiveState !== false) {
          this.diag('sync-check', 'active device state', {
            isActive: false,
            otherDeviceId: undefined,
            otherDeviceName: 'no row',
          });
          lastLoggedActiveState = false;
        }
        return { isActive: false };
      }
      // Transient error — do NOT update the cached flag. Return a
      // best-effort "not active" so the UI shows the modal rather than
      // silently letting an inactive device push data.
      console.warn('[TabFlow] isActiveDeviceFromDb query failed:', error.message);
      return { isActive: false };
    }

    if (!data) {
      this._isActiveDevice = false;
      return { isActive: false };
    }

    const isActive = data.device_id === this.deviceId;
    this._isActiveDevice = isActive;
    if (lastLoggedActiveState !== isActive) {
      this.diag('sync-check', 'active device state', {
        isActive,
        otherDeviceId: data.device_id?.slice(0, 8),
        otherDeviceName: data.device_name,
      });
      lastLoggedActiveState = isActive;
    }
    return { isActive, claimedBy: isActive ? undefined : data.device_name };
  }

  /**
   * 0.1.45: Diagnostic helper. Returns the raw active_devices row for
   * this user, including last_heartbeat, so the Diagnose report can
   * show heartbeat age and which device currently holds the claim.
   * Returns null if there's no row or a transient error occurred.
   */
  async getActiveDeviceInfoForDiagnostics(): Promise<{ device_id: string; device_name: string | null; last_heartbeat: string | null } | null> {
    if (!this.userId) return null;
    try {
      const { data, error } = await this.supabase
        .from('active_devices')
        .select('device_id, device_name, last_heartbeat')
        .eq('user_id', this.userId)
        .single();
      if (error || !data) return null;
      return {
        device_id: data.device_id,
        device_name: data.device_name ?? null,
        last_heartbeat: data.last_heartbeat ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * 0.1.45: Diagnostic accessor. Returns this device's internal ID
   * (populated in initDeviceSession). Read-only.
   */
  getDeviceIdForDiagnostics(): string | null {
    return this.deviceId;
  }

  /**
   * Initializes device session tracking.
   * Generates/retrieves a device ID, subscribes to active_devices changes,
   * and checks current status.
   */
  async initDeviceSession(deviceId: string): Promise<void> {
    this.deviceId = deviceId;

    // Subscribe to active_devices changes for this user
    if (this.userId) {
      this.deviceChannel = this.supabase
        .channel(`active_devices:user_id=eq.${this.userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'active_devices',
            filter: `user_id=eq.${this.userId}`,
          },
          (payload: any) => this.handleDeviceChange(payload)
        )
        .subscribe();
    }

    // Check current active device
    await this.checkActiveDevice();
  }

  /**
   * Claims this device as the active device. Other devices will see
   * "Resume Working Here" banner.
   */
  async claimActiveDevice(): Promise<void> {
    if (!this.userId || !this.deviceId) return;

    const deviceName = getDeviceName();

    this.diag('sync-claim', 'claiming', {
      deviceId: this.deviceId?.slice(0, 8),
      deviceName,
    });

    const { error } = await this.supabase
      .from('active_devices')
      .upsert(
        {
          user_id: this.userId,
          device_id: this.deviceId,
          device_name: deviceName,
          claimed_at: new Date().toISOString(),
          last_heartbeat: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.error('[TabFlow] Failed to claim active device:', error);
      return;
    }

    this._isActiveDevice = true;
    this.startHeartbeat();
    this.onActiveDeviceChange?.(true);
    console.log('[TabFlow] Claimed active device session');
  }

  /**
   * Checks the active_devices table to see if this device is currently active.
   */
  private async checkActiveDevice(): Promise<void> {
    if (!this.userId || !this.deviceId) return;

    const { data, error } = await this.supabase
      .from('active_devices')
      .select('device_id, device_name, last_heartbeat')
      .eq('user_id', this.userId)
      .single();

    console.log(`[TabFlow] checkActiveDevice: myDeviceId=${this.deviceId}, row=${JSON.stringify(data)}, error=${error?.code || 'none'}`);

    if (error) {
      // Supabase .single() returns error code PGRST116 when zero rows match.
      // That means no device has claimed yet — safe to auto-claim.
      if (error.code === 'PGRST116') {
        await this.claimActiveDevice();
      } else {
        // Transient error (network, auth, server). Default to inactive
        // so the user is prompted to click Resume Working Here rather
        // than this device silently stealing the session.
        console.warn('[TabFlow] checkActiveDevice query failed, defaulting to inactive:', error.message);
        this._isActiveDevice = false;
        this.onActiveDeviceChange?.(false);
      }
      return;
    }

    if (!data) {
      // No row exists — this device auto-claims
      await this.claimActiveDevice();
      return;
    }

    if (data.device_id === this.deviceId) {
      // This device is recorded as active. Re-claim and continue.
      this._isActiveDevice = true;
      this.startHeartbeat();
      this.onActiveDeviceChange?.(true);
    } else {
      // Another device holds the active claim. ALWAYS show the modal
      // so the user explicitly chooses to take over — regardless of
      // whether the other device's heartbeat is stale.
      //
      // Why not auto-claim on stale heartbeat? Two reasons:
      // (1) MV3 service workers go to sleep after ~30s of idle, which
      //     stops the heartbeat interval. Chrome can look "stale" while
      //     the user is still actively using it — they just haven't
      //     triggered a tab event recently. Auto-claiming would silently
      //     steal the session.
      // (2) After a destructive pull, the claiming browser has local
      //     workspaces. On next load it would pass a "has local data"
      //     check and auto-claim again without pulling fresh cloud data,
      //     potentially pushing stale local state back up.
      //
      // The only auto-claim path is line 275: same device_id reconnecting.
      console.log(`[TabFlow] Another device is active (${data.device_name}) — showing Resume Working Here modal`);
      this._isActiveDevice = false;
      this.onActiveDeviceChange?.(false, data.device_name);
    }
  }

  /**
   * Handles realtime changes to the active_devices table.
   *
   * Realtime payloads are treated as a trigger to re-read the DB, not as
   * authoritative data — Supabase can deliver events out of order under
   * load, and we don't want a stale payload to stomp on the real state.
   * The payload tells us "something changed"; `isActiveDeviceFromDb()`
   * tells us what it actually is now.
   */
  private async handleDeviceChange(_payload: any): Promise<void> {
    if (!this.deviceId) return;
    const wasActive = this._isActiveDevice;
    const { isActive, claimedBy } = await this.isActiveDeviceFromDb();

    if (isActive && !wasActive) {
      // We just became active (we claimed, or reclaimed after another
      // device abandoned the slot).
      this.startHeartbeat();
      this.onActiveDeviceChange?.(true);
    } else if (!isActive && wasActive) {
      // Another device claimed — we're inactive now.
      this.stopHeartbeat();
      this.onActiveDeviceChange?.(false, claimedBy);
      console.log(`[TabFlow] Another device claimed active${claimedBy ? `: ${claimedBy}` : ''}`);
    }
  }

  /**
   * Starts the heartbeat interval (every 30 seconds).
   * The heartbeat updates last_heartbeat so other devices know we're alive.
   */
  private startHeartbeat(): void {
    this.stopHeartbeat(); // clear any existing

    this.heartbeatInterval = setInterval(async () => {
      if (!this.userId || !this.deviceId || !this._isActiveDevice) return;

      // 0.1.52: refresh device_name too so a device that changed browser
      // identity (e.g., after a Firefox migration from a Chrome install)
      // shows up correctly in Supabase / the Diagnose report.
      await this.supabase
        .from('active_devices')
        .update({
          last_heartbeat: new Date().toISOString(),
          device_name: getDeviceName(),
        })
        .eq('user_id', this.userId)
        .eq('device_id', this.deviceId);
    }, 30_000); // every 30 seconds
  }

  /** Stops the heartbeat interval. */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Closes all active real-time subscriptions.
   *
   * @returns Promise that resolves when all channels are unsubscribed
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();

    if (this.deviceChannel) {
      await this.supabase.removeChannel(this.deviceChannel);
      this.deviceChannel = null;
    }

    if (this.workspacesChannel) {
      await this.supabase.removeChannel(this.workspacesChannel);
      this.workspacesChannel = null;
    }

    if (this.tabsChannel) {
      await this.supabase.removeChannel(this.tabsChannel);
      this.tabsChannel = null;
    }

    this.userId = null;
  }

  /**
   * Fetch the user's UI preferences blob from user_settings.preferences.
   * Returns an empty object if the column is missing (older databases),
   * the row doesn't exist yet, or any error — never throws.
   */
  async getPreferences(userId: string): Promise<Record<string, unknown>> {
    try {
      const { data, error } = await this.supabase
        .from('user_settings')
        .select('preferences')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) return {};
      const prefs = (data && data.preferences) || {};
      if (typeof prefs !== 'object' || Array.isArray(prefs)) return {};
      return prefs as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /**
   * Merge the given partial preferences object into user_settings.preferences.
   * Atomic at the row level via jsonb merge (`existing || new`). Skips if the
   * row doesn't exist; caller is responsible for creating the row first
   * during salt setup. Failures are swallowed — preferences are not critical.
   */
  async setPreferences(userId: string, partial: Record<string, unknown>): Promise<void> {
    try {
      // Read-modify-write. JSONB merge could be done server-side with
      // `preferences = preferences || ?::jsonb`, but supabase-js doesn't
      // expose raw SQL ops conveniently for non-RPC paths. The volume here
      // is tiny (one or two writes per resize drag) so the round-trip is fine.
      const existing = await this.getPreferences(userId);
      const merged = { ...existing, ...partial };
      await this.supabase
        .from('user_settings')
        .update({ preferences: merged })
        .eq('user_id', userId);
    } catch {
      // Non-fatal — preferences are best-effort.
    }
  }

  /**
   * Pushes a new or updated workspace to Supabase (encrypted).
   *
   * Encrypts the workspace name and upserts it to the database.
   * The workspace is encrypted client-side before transmission.
   *
   * @param workspace - The workspace to push
   * @returns Promise that resolves when the operation completes
   * @throws Error if the push fails or encryption fails
   *
   * @example
   * ```ts
   * await client.pushWorkspace({
   *   id: 'ws-1',
   *   userId: 'user-123',
   *   name: 'Work',
   *   color: '#FF5733',
   *   sortOrder: 0,
   *   isActive: true,
   *   updatedAt: new Date(),
   *   version: 1,
   * });
   * ```
   */
  async pushWorkspace(workspace: Workspace): Promise<void> {
    this.diag('sync-push', 'workspace', {
      id: workspace.id?.slice(0, 8),
      name: workspace.name,
      isActive: workspace.isActive,
    });
    // Encrypt the workspace name
    const encryptedName = await encrypt(workspace.name, this.encryptionKey);

    // Track this ID so the Realtime echo is ignored
    this.recentlyPushedIds.add(workspace.id);
    setTimeout(() => this.recentlyPushedIds.delete(workspace.id), 5000);

    const { error } = await this.supabase
      .from('workspaces')
      .upsert(
        {
          id: workspace.id,
          user_id: workspace.userId,
          name: encryptedName,
          color: workspace.color,
          icon: workspace.icon,
          short_name: workspace.shortName ?? null,
          sort_order: workspace.sortOrder,
          is_active: workspace.isActive,
          updated_at: workspace.updatedAt.toISOString(),
          version: workspace.version,
        },
        { onConflict: 'id' }
      );

    if (error) {
      this.diag('error', 'sync error', {
        operation: 'pushWorkspace',
        error: error.message,
      });
      this.notifySchemaCacheError(error.message, 'pushWorkspace');
      throw new Error(`Failed to push workspace: ${error.message}`);
    }
    this.notifySchemaCacheClear('pushWorkspace');
  }

  /**
   * Pushes a new or updated tab to Supabase (encrypted).
   *
   * Encrypts the tab's URL and title before transmission.
   * The workspace_id is stored for denormalization to enable efficient queries.
   *
   * @param tab - The tab to push
   * @returns Promise that resolves when the operation completes
   * @throws Error if the push fails or encryption fails
   *
   * @example
   * ```ts
   * await client.pushTab({
   *   id: 'tab-1',
   *   workspaceId: 'ws-1',
   *   url: 'https://example.com',
   *   title: 'Example Site',
   *   sortOrder: 0,
   *   isPinned: false,
   *   lastAccessed: new Date(),
   *   updatedAt: new Date(),
   * });
   * ```
   */
  async pushTab(tab: Tab, options?: { excludeScroll?: boolean }): Promise<void> {
    this.diag('sync-push', 'tab', {
      id: tab.id?.slice(0, 8),
      workspaceId: tab.workspaceId?.slice(0, 8),
    });
    // Encrypt the tab's URL and title
    const encryptedTab = await encryptTab(tab, this.encryptionKey);

    // Track this ID so the Realtime echo is ignored
    this.recentlyPushedIds.add(tab.id);
    setTimeout(() => this.recentlyPushedIds.delete(tab.id), 5000);

    const payload: Record<string, unknown> = {
      id: tab.id,
      workspace_id: tab.workspaceId,
      url: encryptedTab.url,
      title: encryptedTab.title,
      favicon_url: tab.faviconUrl,
      sort_order: tab.sortOrder,
      is_pinned: tab.isPinned,
      last_accessed: tab.lastAccessed.toISOString(),
      updated_at: tab.updatedAt.toISOString(),
      user_id: this.userId,
      // 0.1.46: user-controlled tab preservation (Firefox-only at runtime,
      // but stored in the shared schema so the setting follows the user
      // across devices). Default false when not set on the record.
      persistent: tab.persistent ?? false,
    };

    // When excludeScroll is true, omit scroll_x/scroll_y from the upsert.
    // On INSERT (new row): columns get their DEFAULT (0).
    // On UPDATE (existing row): columns keep their current values.
    // This prevents snapshot pushes from overwriting scroll values that
    // SAVE_SCROLL_POSITION just pushed — snapshots read tabs in a batch
    // but push them one by one, creating a window where a fresher scroll
    // update can be clobbered by the stale batch.
    if (!options?.excludeScroll) {
      payload.scroll_x = tab.scrollX ?? 0;
      payload.scroll_y = tab.scrollY ?? 0;
    }

    const { error } = await this.supabase
      .from('tabs')
      .upsert(payload, { onConflict: 'id' });

    if (error) {
      this.diag('error', 'sync error', {
        operation: 'pushTab',
        error: error.message,
      });
      this.notifySchemaCacheError(error.message, 'pushTab');
      throw new Error(`Failed to push tab: ${error.message}`);
    }
    this.notifySchemaCacheClear('pushTab');
  }

  /**
   * Fetch the scroll position for a single tab from Supabase.
   * Used by GET_SCROLL_POSITION to get the freshest cross-device value
   * without requiring a full pullAll.
   */
  async getTabScroll(tabId: string): Promise<{ data: { scroll_x: number; scroll_y: number } | null }> {
    const { data, error } = await this.supabase
      .from('tabs')
      .select('scroll_x, scroll_y')
      .eq('id', tabId)
      .single();

    if (error) {
      // Row might not exist yet — not an error for our purposes
      return { data: null };
    }
    return { data };
  }

  /**
   * Push ONLY the scroll position for a single tab.
   * Uses UPDATE (not upsert) so it only touches existing rows and only
   * modifies the scroll_x / scroll_y columns — no risk of clobbering
   * structural tab data or racing with snapshot pushes.
   */
  async pushTabScroll(tabId: string, scrollX: number, scrollY: number): Promise<void> {
    const { error } = await this.supabase
      .from('tabs')
      .update({ scroll_x: scrollX, scroll_y: scrollY })
      .eq('id', tabId);

    if (error) {
      throw new Error(`Failed to push tab scroll: ${error.message}`);
    }
  }

  /**
   * Replaces the full set of tabs for a workspace in Supabase.
   *
   * This is the ONE correct way to sync per-workspace tab state, because
   * local saves re-generate tab IDs on every workspace snapshot — if we only
   * ever upsert new rows, Supabase accumulates zombies that each device
   * re-pulls forever.
   *
   * Flow:
   *   1. Query the current set of cloud tab IDs for this workspace
   *   2. Upsert every local tab (filtered to syncable URLs / favicons)
   *   3. Delete any cloud IDs that weren't in the pushed set
   *
   * The caller is responsible for wrapping this in setPushing(true/false).
   */
  async replaceWorkspaceTabs(workspaceId: string, tabs: Tab[]): Promise<{ pushed: number; deleted: number }> {
    // 1. What's in the cloud right now for this workspace?
    const { data: cloudRows, error: selectError } = await this.supabase
      .from('tabs')
      .select('id')
      .eq('workspace_id', workspaceId);

    if (selectError) {
      throw new Error(`Failed to list cloud tabs for workspace: ${selectError.message}`);
    }

    const cloudIds = new Set<string>((cloudRows || []).map((r) => r.id));

    // 2. Upsert each syncable tab. Track which IDs we kept.
    const keptIds = new Set<string>();
    let pushed = 0;
    for (const tab of tabs) {
      if (!isSyncableTabUrl(tab.url)) continue;
      const toPush: Tab = isSyncableFaviconUrl(tab.faviconUrl)
        ? tab
        : { ...tab, faviconUrl: undefined };
      await this.pushTab(toPush, { excludeScroll: true });
      keptIds.add(tab.id);
      pushed++;
    }

    // 3. Delete anything in the cloud that isn't in the new set.
    const toDelete: string[] = [];
    for (const id of cloudIds) {
      if (!keptIds.has(id)) toDelete.push(id);
    }

    if (toDelete.length > 0) {
      const { error: deleteError } = await this.supabase
        .from('tabs')
        .delete()
        .in('id', toDelete);
      if (deleteError) {
        console.warn(
          `[TabFlow] Failed to prune stale cloud tabs for workspace ${workspaceId}:`,
          deleteError
        );
      }
    }

    return { pushed, deleted: toDelete.length };
  }

  /**
   * Deletes a workspace from Supabase.
   *
   * @param id - The workspace ID to delete
   * @returns Promise that resolves when the operation completes
   * @throws Error if the delete fails
   *
   * @example
   * ```ts
   * await client.deleteWorkspace('ws-1');
   * ```
   */
  async deleteWorkspace(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('workspaces')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete workspace: ${error.message}`);
    }
  }

  /**
   * Deletes a tab from Supabase.
   *
   * @param id - The tab ID to delete
   * @returns Promise that resolves when the operation completes
   * @throws Error if the delete fails
   *
   * @example
   * ```ts
   * await client.deleteTab('tab-1');
   * ```
   */
  /**
   * Returns the IDs of all tab rows in Supabase for the given workspace.
   * Used by the snapshot push to identify cloud orphans - IDs that exist
   * in cloud but not locally - so they can be deleted.
   */
  async getTabIdsForWorkspace(workspaceId: string, userId: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('tabs')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId);
    if (error) {
      throw new Error(`Failed to fetch tab IDs for workspace ${workspaceId}: ${error.message}`);
    }
    return (data ?? []).map((row) => row.id);
  }

  async deleteTab(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('tabs')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete tab: ${error.message}`);
    }
  }

  /**
   * Wipes all local workspaces and tabs from IndexedDB.
   * Used before a destructive pull so the local state becomes an exact
   * mirror of the cloud, with no leftover junk from previous sessions.
   */
  async clearLocalData(): Promise<void> {
    const localWorkspaces = await this.storage.getWorkspaces(this.localUserId);
    for (const ws of localWorkspaces) {
      const tabs = await this.storage.getTabs(ws.id);
      for (const tab of tabs) {
        await this.storage.deleteTab(tab.id);
      }
      await this.storage.deleteWorkspace(ws.id);
    }
    console.log(`[TabFlow] Cleared ${localWorkspaces.length} local workspaces`);
  }

  /**
   * Pushes ALL local workspaces + tabs to the cloud AND deletes any
   * cloud rows that don't exist locally. After this runs, the cloud
   * is an exact mirror of local IndexedDB.
   *
   * Call this after a successful claim so the new active device's
   * state immediately becomes the cloud truth.
   */
  async fullSyncPush(userId: string): Promise<void> {
    // Get all local workspaces and tabs
    const localWorkspaces = await this.storage.getWorkspaces(this.localUserId);
    const localWorkspaceIds = new Set(localWorkspaces.map((ws) => ws.id));
    const localTabIds = new Set<string>();

    // Push all local workspaces and their tabs.
    // Exclude scroll from the upsert — scroll values in the cloud were set
    // by SAVE_SCROLL_POSITION and should not be overwritten by a bulk push.
    for (const ws of localWorkspaces) {
      await this.pushWorkspace({ ...ws, userId });
      const tabs = await this.storage.getTabs(ws.id);
      for (const tab of tabs) {
        await this.pushTab(tab, { excludeScroll: true });
        localTabIds.add(tab.id);
      }
    }

    // Fetch cloud workspace IDs and delete orphans
    const { data: cloudWorkspaces } = await this.supabase
      .from('workspaces')
      .select('id')
      .eq('user_id', userId);

    if (cloudWorkspaces) {
      const orphanWorkspaceIds = cloudWorkspaces
        .filter((cw) => !localWorkspaceIds.has(cw.id))
        .map((cw) => cw.id);
      if (orphanWorkspaceIds.length > 0) {
        // Delete orphan tabs first (they reference the workspace)
        await this.supabase
          .from('tabs')
          .delete()
          .in('workspace_id', orphanWorkspaceIds);
        await this.supabase
          .from('workspaces')
          .delete()
          .in('id', orphanWorkspaceIds);
        console.log(`[TabFlow] Deleted ${orphanWorkspaceIds.length} orphan workspace(s) from cloud`);
      }
    }

    // Fetch cloud tab IDs and delete orphans
    const { data: cloudTabs } = await this.supabase
      .from('tabs')
      .select('id')
      .eq('user_id', userId);

    if (cloudTabs) {
      const orphanTabIds = cloudTabs
        .filter((ct) => !localTabIds.has(ct.id))
        .map((ct) => ct.id);
      if (orphanTabIds.length > 0) {
        // Delete in batches to avoid hitting Supabase limits
        for (let i = 0; i < orphanTabIds.length; i += 100) {
          const batch = orphanTabIds.slice(i, i + 100);
          await this.supabase
            .from('tabs')
            .delete()
            .in('id', batch);
        }
        console.log(`[TabFlow] Deleted ${orphanTabIds.length} orphan tab(s) from cloud`);
      }
    }

    console.log(`[TabFlow] Full sync push complete: ${localWorkspaces.length} workspaces, ${localTabIds.size} tabs`);
  }

  /**
   * Performs a full sync from Supabase — pulls all workspaces and tabs.
   *
   * When `destructive` is true (used during claim), clears all local
   * workspaces and tabs first so the result is an exact mirror of the cloud.
   * When false (default), does an additive upsert.
   */
  async pullAll(userId: string, destructive = false): Promise<void> {
    this.diag('sync-pull', 'pullAll starting', { destructive });
    // Fetch all workspaces for the user
    const { data: workspacesData, error: workspacesError } = await this.supabase
      .from('workspaces')
      .select('*')
      .eq('user_id', userId);

    if (workspacesError) {
      throw new Error(`Failed to pull workspaces: ${workspacesError.message}`);
    }

    // Fetch all tabs for the user
    const { data: tabsData, error: tabsError } = await this.supabase
      .from('tabs')
      .select('*')
      .eq('user_id', userId);

    if (tabsError) {
      throw new Error(`Failed to pull tabs: ${tabsError.message}`);
    }

    // In destructive mode, clear all local data first so we get an exact
    // mirror of the cloud with no leftover junk. As of 0.1.37 the
    // workspaces.short_name column makes the old shortNameMap preservation
    // hack unnecessary — shortName now round-trips through Supabase like any
    // other workspace field.
    if (destructive) {
      await this.clearLocalData();
    }

    // Decrypt and save workspaces. shortName comes from the new short_name
    // column (added 2026-06-22 — see migration 006). Falls back to undefined
    // for older cloud rows that don't have the column set yet.
    if (workspacesData && workspacesData.length > 0) {
      const decryptedWorkspaces = await Promise.all(
        workspacesData.map(async (ws) => {
          const decryptedName = await decrypt(ws.name, this.encryptionKey);
          return {
            id: ws.id,
            userId: this.localUserId,
            name: decryptedName,
            color: ws.color,
            icon: ws.icon,
            sortOrder: ws.sort_order,
            isActive: ws.is_active,
            updatedAt: new Date(ws.updated_at),
            version: ws.version,
            shortName: ws.short_name ?? undefined,
          } as Workspace;
        })
      );

      for (const workspace of decryptedWorkspaces) {
        await this.storage.saveWorkspace(workspace);
      }
    }

    // Decrypt and save tabs — filtering out any tabs that represent
    // browser-internal URLs. These sneak in when older builds (or the other
    // browser) pushed their own extension pages / chrome:// URLs into the
    // cloud. We drop them on import AND delete them from Supabase so they
    // stop echoing back to every device.
    if (tabsData && tabsData.length > 0) {
      const badIds: string[] = [];
      const decryptedTabs: Tab[] = [];
      for (const tab of tabsData) {
        try {
          const decrypted = await decryptTab(
            { url: tab.url, title: tab.title },
            this.encryptionKey
          );
          if (!isSyncableTabUrl(decrypted.url)) {
            console.log(
              `[TabFlow] Dropping non-syncable tab from cloud: ${decrypted.url}`
            );
            badIds.push(tab.id);
            continue;
          }
          decryptedTabs.push({
            id: tab.id,
            workspaceId: tab.workspace_id,
            url: decrypted.url,
            title: decrypted.title,
            faviconUrl: isSyncableFaviconUrl(tab.favicon_url)
              ? tab.favicon_url
              : undefined,
            sortOrder: tab.sort_order,
            isPinned: tab.is_pinned,
            lastAccessed: new Date(tab.last_accessed),
            updatedAt: new Date(tab.updated_at),
            scrollX: tab.scroll_x ?? 0,
            scrollY: tab.scroll_y ?? 0,
            // 0.1.46: user-controlled tab preservation across workspace switches.
            persistent: tab.persistent ?? false,
          });
        } catch (err) {
          console.warn('[TabFlow] Failed to decrypt tab on pull:', tab.id, err);
        }
      }

      for (const tabRecord of decryptedTabs) {
        await this.storage.saveTab(tabRecord);
      }

      // Clean up the bad rows in Supabase so they don't keep coming back.
      if (badIds.length > 0) {
        const { error: cleanupError } = await this.supabase
          .from('tabs')
          .delete()
          .in('id', badIds);
        if (cleanupError) {
          console.warn(
            '[TabFlow] Failed to clean up bad tabs in Supabase:',
            cleanupError
          );
        } else {
          console.log(
            `[TabFlow] Cleaned up ${badIds.length} bad tab(s) from Supabase.`
          );
        }
      }
    }

    this.diag('sync-pull', 'pullAll complete', {
      workspaceCount: workspacesData?.length ?? 0,
      tabCount: tabsData?.length ?? 0,
      historyCount: 0,
      deletedCount: 0,
    });
  }

  /**
   * Handles incoming workspace changes from Supabase Realtime.
   *
   * Decrypts the data and writes it to local IndexedDB.
   * Deleted workspaces are removed from local storage.
   *
   * @param payload - The change event from Supabase
   * @private
   */
  /** Set pushing flag to suppress echo from our own changes */
  setPushing(value: boolean) {
    this.isPushing = value;
  }

  private async handleWorkspaceChange(_payload: SupabaseSyncEvent): Promise<void> {
    // DISABLED — realtime workspace writes cause cross-browser contamination.
    //
    // TabFlow's sync model: the active device pushes on every snapshot;
    // the other device does a destructive pull when claiming. There is no
    // need for the non-active device to apply incoming workspace changes
    // because it will pull everything fresh on claim anyway.
    //
    // The race condition: when Firefox claims, Supabase delivers realtime
    // events for both `active_devices` (device change) and `workspaces`
    // (Firefox's push) — but in *arbitrary* order. If Chrome receives
    // workspace events before the active_devices event, it still thinks
    // it's active and writes Firefox's data into its own IndexedDB. Then
    // Chrome's snapshot pushes it all back up, creating duplicates and
    // cross-workspace contamination.
    //
    // The active_devices subscription (in initDeviceSession) is kept — it
    // only updates _isActiveDevice and triggers the Resume modal, which is
    // safe and necessary.
    return;
  }

  /**
   * Handles incoming tab changes from Supabase Realtime.
   *
   * Decrypts the URL and title, then writes to local IndexedDB.
   * Deleted tabs are removed from local storage.
   *
   * @param payload - The change event from Supabase
   * @private
   */
  private async handleTabChange(_payload: SupabaseSyncEvent): Promise<void> {
    // DISABLED — same race condition as handleWorkspaceChange (see comment
    // there). Realtime tab writes from the other browser contaminate the
    // local IndexedDB and cause duplicate tabs + cross-workspace leaks.
    //
    // All data transfer between browsers goes through:
    //   Push path:  snapshotActiveWorkspace → pushWorkspace + pushTab
    //   Pull path:  claimActiveDeviceWithMaterialization → pullAll(destructive)
    //   Cleanup:    fullSyncPush deletes cloud orphans
    //
    // No realtime tab handler is needed.
    return;
  }

  // ─── WORKSPACE HISTORY SYNC (added 2026-06-22) ──────────────────────────
  //
  // Mirrors the local IndexedDB workspaceHistory table to Supabase so the
  // History panel (per-workspace tab snapshots) follows the user across
  // devices. The tab snapshot array is JSON-stringified then encrypted with
  // the same passphrase-derived key as tabs/workspaces, so the cloud host
  // can't read it.

  /**
   * Push a single history entry to Supabase (encrypted).
   * Idempotent on the entry's `id` (acts as primary key in the new
   * workspace_history table). Safe to call multiple times.
   */
  async pushHistoryEntry(entry: WorkspaceHistoryEntry, userId: string): Promise<void> {
    this.diag('sync-push', 'history entry', {
      workspaceId: entry.workspaceId?.slice(0, 8),
    });
    const payload = JSON.stringify(entry.tabs);
    const encryptedPayload = await encrypt(payload, this.encryptionKey);

    const { error } = await this.supabase
      .from('workspace_history')
      .upsert(
        {
          id: entry.id,
          user_id: userId,
          workspace_id: entry.workspaceId,
          tab_snapshots: encryptedPayload,
          created_at: entry.timestamp.toISOString(),
        },
        { onConflict: 'id' }
      );

    if (error) {
      this.diag('error', 'sync error', {
        operation: 'pushHistoryEntry',
        error: error.message,
      });
      this.notifySchemaCacheError(error.message, 'pushHistoryEntry');
      throw new Error(`Failed to push history entry: ${error.message}`);
    }
    this.notifySchemaCacheClear('pushHistoryEntry');
  }

  /**
   * Pull all history entries for the user from Supabase.
   * Decryption failures (e.g. stale entries from a previous passphrase)
   * are logged and skipped — they don't break the whole pull.
   */
  async pullHistory(userId: string): Promise<WorkspaceHistoryEntry[]> {
    const { data, error } = await this.supabase
      .from('workspace_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to pull history: ${error.message}`);
    }
    if (!data) return [];

    const result: WorkspaceHistoryEntry[] = [];
    for (const row of data) {
      try {
        const decrypted = await decrypt(row.tab_snapshots, this.encryptionKey);
        const tabs = JSON.parse(decrypted);
        if (!Array.isArray(tabs)) {
          console.warn('[TabFlow] history payload not an array, skipping:', row.id);
          continue;
        }
        result.push({
          id: row.id,
          workspaceId: row.workspace_id,
          timestamp: new Date(row.created_at),
          tabs,
        });
      } catch (err) {
        console.warn('[TabFlow] Failed to decrypt history entry:', row.id, err);
      }
    }
    return result;
  }

  /**
   * Delete history entries older than 30 days from Supabase.
   * Fire-and-forget — failures are logged, not thrown.
   */
  async pruneOldHistory(userId: string): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await this.supabase
        .from('workspace_history')
        .delete()
        .eq('user_id', userId)
        .lt('created_at', cutoff);
      if (error) {
        console.warn('[TabFlow] pruneOldHistory failed:', error.message);
      }
    } catch (err) {
      console.warn('[TabFlow] pruneOldHistory error:', err);
    }
  }

  // ─── DELETED WORKSPACES SYNC (added 2026-06-22) ─────────────────────────
  //
  // Mirrors the local IndexedDB deletedWorkspaces table (recycle bin).
  // workspace_data is JSON-stringified { workspace, tabs } encrypted with
  // the same key. Restoring deletes the cloud row.

  /**
   * Push a deleted-workspace archive entry to Supabase (encrypted).
   * Upsert by entry.id so retries are idempotent.
   */
  async pushDeletedWorkspace(deleted: DeletedWorkspace, userId: string): Promise<void> {
    this.diag('sync-push', 'deleted workspace', {
      workspaceId:
        (deleted as any).workspaceId?.slice(0, 8) ||
        (deleted as any).id?.slice(0, 8),
    });
    const payload = JSON.stringify({
      workspace: deleted.workspace,
      tabs: deleted.tabs,
    });
    const encryptedPayload = await encrypt(payload, this.encryptionKey);

    const { error } = await this.supabase
      .from('deleted_workspaces')
      .upsert(
        {
          id: deleted.id,
          user_id: userId,
          workspace_id: deleted.workspace.id,
          workspace_data: encryptedPayload,
          deleted_at: deleted.deletedAt.toISOString(),
        },
        { onConflict: 'id' }
      );

    if (error) {
      this.diag('error', 'sync error', {
        operation: 'pushDeletedWorkspace',
        error: error.message,
      });
      this.notifySchemaCacheError(error.message, 'pushDeletedWorkspace');
      throw new Error(`Failed to push deleted workspace: ${error.message}`);
    }
    this.notifySchemaCacheClear('pushDeletedWorkspace');
  }

  /**
   * Permanently remove an archived workspace from the cloud archive.
   * Called when the user restores from the recycle bin or empties it.
   */
  async pushRestoredWorkspace(deletedId: string, userId: string): Promise<void> {
    this.diag('sync-push', 'restored workspace', {
      deletedId: deletedId?.slice(0, 8),
    });
    const { error } = await this.supabase
      .from('deleted_workspaces')
      .delete()
      .eq('id', deletedId)
      .eq('user_id', userId);

    if (error) {
      this.diag('error', 'sync error', {
        operation: 'pushRestoredWorkspace',
        error: error.message,
      });
      throw new Error(`Failed to remove archived workspace: ${error.message}`);
    }
  }

  /**
   * Pull all archived workspaces for the user from Supabase.
   * Decryption failures are logged and skipped.
   */
  async pullDeletedWorkspaces(userId: string): Promise<DeletedWorkspace[]> {
    const { data, error } = await this.supabase
      .from('deleted_workspaces')
      .select('*')
      .eq('user_id', userId)
      .order('deleted_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to pull deleted workspaces: ${error.message}`);
    }
    if (!data) return [];

    const result: DeletedWorkspace[] = [];
    for (const row of data) {
      try {
        const decrypted = await decrypt(row.workspace_data, this.encryptionKey);
        const parsed = JSON.parse(decrypted);
        if (!parsed || typeof parsed !== 'object' || !parsed.workspace || !Array.isArray(parsed.tabs)) {
          console.warn('[TabFlow] deleted_workspaces payload malformed, skipping:', row.id);
          continue;
        }
        // Re-hydrate the Workspace object's Date fields. JSON.stringify
        // serialized them as ISO strings.
        const workspace = parsed.workspace as Workspace;
        if (typeof (workspace.updatedAt as unknown) === 'string') {
          workspace.updatedAt = new Date(workspace.updatedAt as unknown as string);
        }
        // Force userId back to the local user — the originating device may
        // have stored 'local-user' (matches), but be defensive.
        workspace.userId = this.localUserId;

        result.push({
          id: row.id,
          workspace,
          tabs: parsed.tabs,
          deletedAt: new Date(row.deleted_at),
        });
      } catch (err) {
        console.warn('[TabFlow] Failed to decrypt deleted workspace:', row.id, err);
      }
    }
    return result;
  }

  /**
   * Delete archive entries older than 90 days from Supabase.
   * Fire-and-forget — failures are logged, not thrown.
   */
  async pruneOldDeletedWorkspaces(userId: string): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await this.supabase
        .from('deleted_workspaces')
        .delete()
        .eq('user_id', userId)
        .lt('deleted_at', cutoff);
      if (error) {
        console.warn('[TabFlow] pruneOldDeletedWorkspaces failed:', error.message);
      }
    } catch (err) {
      console.warn('[TabFlow] pruneOldDeletedWorkspaces error:', err);
    }
  }
}
