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
import { StorageAdapter, Workspace, Tab } from '@tabflow/core';
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
 * Rejects browser-internal URLs (`chrome://`, `about:`, `moz-extension://`,
 * `chrome-extension://`, `edge://`, etc.) which are either unreachable on other
 * browsers or point back at the extension's own pages. We only want real web
 * pages (http/https) and local files to survive a round-trip through the cloud.
 */
function isSyncableTabUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  if (url.startsWith('file://')) return true;
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
 * Uses the user agent to extract OS info.
 */
export function getDeviceName(): string {
  const ua = navigator.userAgent;
  let os = 'Unknown OS';
  if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('CrOS')) os = 'ChromeOS';
  return `Chrome on ${os}`;
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
    onActiveDeviceChange?: (isActive: boolean, claimedBy?: string) => void
  ) {
    this.supabase = supabase;
    this.storage = storage;
    this.encryptionKey = encryptionKey;
    this.localUserId = localUserId;
    this.onRemoteChange = onRemoteChange;
    this.onActiveDeviceChange = onActiveDeviceChange;
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

    // Subscribe to workspace changes
    this.workspacesChannel = this.supabase
      .channel(`workspaces:user_id=eq.${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'workspaces',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => this.handleWorkspaceChange(payload as SupabaseSyncEvent)
      )
      .subscribe();

    // Subscribe to tab changes (could be filtered by workspace, but including all user's tabs)
    this.tabsChannel = this.supabase
      .channel(`tabs:user_id=eq.${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tabs',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => this.handleTabChange(payload as SupabaseSyncEvent)
      )
      .subscribe();
  }

  // ─── DEVICE SESSION MANAGEMENT ────────────────────────────────────

  /** Whether this device currently holds the active session */
  get isActiveDevice(): boolean {
    return this._isActiveDevice;
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

    if (error || !data) {
      // No active device claimed yet — this device auto-claims
      await this.claimActiveDevice();
      return;
    }

    if (data.device_id === this.deviceId) {
      // We are the active device
      this._isActiveDevice = true;
      this.startHeartbeat();
      this.onActiveDeviceChange?.(true);
    } else {
      // Another device is active — check if it's stale (no heartbeat in 2 minutes)
      const lastBeat = new Date(data.last_heartbeat).getTime();
      const staleThreshold = 2 * 60 * 1000; // 2 minutes
      if (Date.now() - lastBeat > staleThreshold) {
        console.log('[TabFlow] Active device is stale, auto-claiming');
        await this.claimActiveDevice();
      } else {
        this._isActiveDevice = false;
        this.onActiveDeviceChange?.(false, data.device_name);
      }
    }
  }

  /**
   * Handles realtime changes to the active_devices table.
   * When another device claims, this device becomes inactive.
   */
  private handleDeviceChange(payload: any): void {
    const newData = payload.new;
    if (!newData || !this.deviceId) return;

    if (newData.device_id === this.deviceId) {
      // We claimed (or re-claimed) — we're active
      if (!this._isActiveDevice) {
        this._isActiveDevice = true;
        this.startHeartbeat();
        this.onActiveDeviceChange?.(true);
      }
    } else {
      // Another device claimed — we're now inactive
      if (this._isActiveDevice) {
        this._isActiveDevice = false;
        this.stopHeartbeat();
        this.onActiveDeviceChange?.(false, newData.device_name);
        console.log(`[TabFlow] Another device claimed active: ${newData.device_name}`);
      }
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

      await this.supabase
        .from('active_devices')
        .update({ last_heartbeat: new Date().toISOString() })
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
          sort_order: workspace.sortOrder,
          is_active: workspace.isActive,
          updated_at: workspace.updatedAt.toISOString(),
          version: workspace.version,
        },
        { onConflict: 'id' }
      );

    if (error) {
      throw new Error(`Failed to push workspace: ${error.message}`);
    }
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
  async pushTab(tab: Tab): Promise<void> {
    // Encrypt the tab's URL and title
    const encryptedTab = await encryptTab(tab, this.encryptionKey);

    // Track this ID so the Realtime echo is ignored
    this.recentlyPushedIds.add(tab.id);
    setTimeout(() => this.recentlyPushedIds.delete(tab.id), 5000);

    const { error } = await this.supabase
      .from('tabs')
      .upsert(
        {
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
        },
        { onConflict: 'id' }
      );

    if (error) {
      throw new Error(`Failed to push tab: ${error.message}`);
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
      await this.pushTab(toPush);
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
   * Performs an initial full sync from Supabase.
   *
   * Fetches all workspaces and tabs for the user, decrypts them,
   * and writes them to local IndexedDB. Useful for initial sync on login.
   *
   * @param userId - The ID of the user to pull data for
   * @returns Promise that resolves when the sync is complete
   * @throws Error if the fetch or decryption fails
   *
   * @example
   * ```ts
   * await client.pullAll(userId);
   * console.log('Initial sync complete');
   * ```
   */
  async pullAll(userId: string): Promise<void> {
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

    // Decrypt and save workspaces
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

  private async handleWorkspaceChange(payload: SupabaseSyncEvent): Promise<void> {
    if (this.isPushing) return; // Skip echoes from our own pushes
    const changeId = payload.new?.id || payload.old?.id;
    if (changeId && this.recentlyPushedIds.has(changeId)) return; // Skip async echoes
    try {
      if (payload.type === 'DELETE') {
        if (payload.old?.id) {
          await this.storage.deleteWorkspace(payload.old.id);
        }
      } else if (payload.new) {
        const decryptedName = await decrypt(payload.new.name, this.encryptionKey);
        const workspace: Workspace = {
          id: payload.new.id,
          userId: this.localUserId,
          name: decryptedName,
          color: payload.new.color,
          icon: payload.new.icon,
          sortOrder: payload.new.sort_order,
          isActive: payload.new.is_active,
          updatedAt: new Date(payload.new.updated_at),
          version: payload.new.version,
        };

        await this.storage.saveWorkspace(workspace);
      }
      this.onRemoteChange?.();
    } catch (error) {
      console.error('Error handling workspace change:', error);
    }
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
  private async handleTabChange(payload: SupabaseSyncEvent): Promise<void> {
    if (this.isPushing) return; // Skip echoes from our own pushes
    const changeId = payload.new?.id || payload.old?.id;
    if (changeId && this.recentlyPushedIds.has(changeId)) return; // Skip async echoes
    try {
      if (payload.type === 'DELETE') {
        if (payload.old?.id) {
          await this.storage.deleteTab(payload.old.id);
        }
      } else if (payload.new) {
        const decrypted = await decryptTab(
          { url: payload.new.url, title: payload.new.title },
          this.encryptionKey
        );

        // Drop browser-internal URLs at the realtime boundary too.
        if (!isSyncableTabUrl(decrypted.url)) {
          console.log(
            `[TabFlow] Ignoring non-syncable realtime tab: ${decrypted.url}`
          );
          // Also clean it out of Supabase so it stops echoing.
          await this.supabase.from('tabs').delete().eq('id', payload.new.id);
          return;
        }

        const tab: Tab = {
          id: payload.new.id,
          workspaceId: payload.new.workspace_id,
          url: decrypted.url,
          title: decrypted.title,
          faviconUrl: isSyncableFaviconUrl(payload.new.favicon_url)
            ? payload.new.favicon_url
            : undefined,
          sortOrder: payload.new.sort_order,
          isPinned: payload.new.is_pinned,
          lastAccessed: new Date(payload.new.last_accessed),
          updatedAt: new Date(payload.new.updated_at),
        };

        await this.storage.saveTab(tab);
      }
      this.onRemoteChange?.();
    } catch (error) {
      console.error('Error handling tab change:', error);
    }
  }
}
