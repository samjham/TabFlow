/**
 * Message handling layer for TabFlow
 * Routes messages between popup/sidebar and background service worker.
 * Wired to real IndexedDB storage via WorkspaceEngine.
 *
 * New model: Handles automatic tab tracking, workspace switching with tab save/restore,
 * and filters tabs to only http/https URLs.
 */

import { WorkspaceEngine } from '@tabflow/core';
import type { Workspace, Tab, StorageAdapter } from '@tabflow/core';
import { TabManager } from './TabManager';

/** The local user ID (single-user for now, auth comes later) */
const LOCAL_USER_ID = 'local-user';

/** Default workspace colors when user doesn't pick one */
const DEFAULT_COLORS = ['#6c8cff', '#00d99f', '#ff6b9d', '#ffb86c', '#bd93f9'];

/**
 * Enum for all message types that can be sent to the background worker
 */
export enum MessageType {
  GET_WORKSPACES = 'GET_WORKSPACES',
  CREATE_WORKSPACE = 'CREATE_WORKSPACE',
  DELETE_WORKSPACE = 'DELETE_WORKSPACE',
  GET_TABS = 'GET_TABS',
  GET_ACTIVE_WORKSPACE_TABS = 'GET_ACTIVE_WORKSPACE_TABS',
  REMOVE_TAB = 'REMOVE_TAB',
  SWITCH_WORKSPACE = 'SWITCH_WORKSPACE',
  RENAME_WORKSPACE = 'RENAME_WORKSPACE',
  CHANGE_WORKSPACE_COLOR = 'CHANGE_WORKSPACE_COLOR',
  REORDER_WORKSPACES = 'REORDER_WORKSPACES',
  CHANGE_WORKSPACE_SHORT_NAME = 'CHANGE_WORKSPACE_SHORT_NAME',
  MOVE_TABS = 'MOVE_TABS',
  CLOSE_ALL_TABS = 'CLOSE_ALL_TABS',
  SAVE_SESSION = 'SAVE_SESSION',
  RESTORE_SESSION = 'RESTORE_SESSION',
  GET_WORKSPACE_HISTORY = 'GET_WORKSPACE_HISTORY',
  RESTORE_HISTORY_ENTRY = 'RESTORE_HISTORY_ENTRY',
  SEARCH_ALL_WORKSPACES = 'SEARCH_ALL_WORKSPACES',
  ACTIVATE_TAB_BY_URL = 'ACTIVATE_TAB_BY_URL',
  GET_THUMBNAILS = 'GET_THUMBNAILS',
  REORDER_TABS = 'REORDER_TABS',
  DUPLICATE_TABS = 'DUPLICATE_TABS',
  GET_DELETED_WORKSPACES = 'GET_DELETED_WORKSPACES',
  RESTORE_DELETED_WORKSPACES = 'RESTORE_DELETED_WORKSPACES',
  PERMANENTLY_DELETE_WORKSPACES = 'PERMANENTLY_DELETE_WORKSPACES',
}

/**
 * Typed message interface for communication with background worker
 */
export interface Message {
  type: MessageType;
  payload?: any;
}

/**
 * Typed response interface from background worker
 */
export interface Response {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * MessageHandler routes messages from popup/sidebar to appropriate handlers.
 * Uses real WorkspaceEngine + IndexedDB storage for persistence.
 */
export class MessageHandler {
  private engine: WorkspaceEngine;
  private tabManager: TabManager;
  private storage: StorageAdapter;
  private onSwitchingWorkspacesChange?: (value: boolean) => void;

  /**
   * When true, the next workspace switch will NOT save the outgoing
   * workspace's tabs. This is set after Chrome restart because we can't
   * trust which tabs Chrome restored into the main window — they may
   * belong to a different workspace. Cleared after the first switch.
   */
  private skipOutgoingSaveOnNextSwitch = false;

  constructor(storage: StorageAdapter, onSwitchingWorkspacesChange?: (value: boolean) => void, tabManager?: TabManager) {
    this.storage = storage;
    this.engine = new WorkspaceEngine(storage);
    this.tabManager = tabManager || new TabManager();
    this.onSwitchingWorkspacesChange = onSwitchingWorkspacesChange;
  }

  /**
   * Tell the handler to skip saving the outgoing workspace on the next
   * workspace switch. Used after Chrome restart when the main window
   * tabs don't match the active workspace.
   */
  setSkipOutgoingSave(value: boolean): void {
    this.skipOutgoingSaveOnNextSwitch = value;
    console.log(`[TabFlow] MessageHandler: skipOutgoingSaveOnNextSwitch = ${value}`);
  }

  /**
   * Main message router
   */
  async handleMessage(message: Message): Promise<Response> {
    console.log('[TabFlow] Handling message:', message.type);

    try {
      switch (message.type) {
        case MessageType.GET_WORKSPACES:
          return await this.handleGetWorkspaces();
        case MessageType.CREATE_WORKSPACE:
          return await this.handleCreateWorkspace(message.payload);
        case MessageType.DELETE_WORKSPACE:
          return await this.handleDeleteWorkspace(message.payload);
        case MessageType.GET_TABS:
          return await this.handleGetTabs(message.payload);
        case MessageType.GET_ACTIVE_WORKSPACE_TABS:
          return await this.handleGetActiveWorkspaceTabs();
        case MessageType.REMOVE_TAB:
          return await this.handleRemoveTab(message.payload);
        case MessageType.CLOSE_ALL_TABS:
          return await this.handleCloseAllTabs(message.payload);
        case MessageType.MOVE_TABS:
          return await this.handleMoveTabs(message.payload);
        case MessageType.RENAME_WORKSPACE:
          return await this.handleRenameWorkspace(message.payload);
        case MessageType.CHANGE_WORKSPACE_COLOR:
          return await this.handleChangeWorkspaceColor(message.payload);
        case MessageType.REORDER_WORKSPACES:
          return await this.handleReorderWorkspaces(message.payload);
        case MessageType.CHANGE_WORKSPACE_SHORT_NAME:
          return await this.handleChangeWorkspaceShortName(message.payload);
        case MessageType.SWITCH_WORKSPACE:
          return await this.handleSwitchWorkspace(message.payload);
        case MessageType.SAVE_SESSION:
          return await this.handleSaveSession(message.payload);
        case MessageType.RESTORE_SESSION:
          return await this.handleRestoreSession(message.payload);
        case MessageType.GET_WORKSPACE_HISTORY:
          return await this.handleGetWorkspaceHistory(message.payload);
        case MessageType.RESTORE_HISTORY_ENTRY:
          return await this.handleRestoreHistoryEntry(message.payload);
        case MessageType.SEARCH_ALL_WORKSPACES:
          return await this.handleSearchAllWorkspaces(message.payload);
        case MessageType.ACTIVATE_TAB_BY_URL:
          return await this.handleActivateTabByUrl(message.payload);
        case MessageType.GET_THUMBNAILS:
          // Handled directly in service worker (needs IndexedDB-specific API)
          return { success: false, error: 'GET_THUMBNAILS must be handled by service worker' };
        case MessageType.REORDER_TABS:
          return await this.handleReorderTabs(message.payload);
        case MessageType.GET_DELETED_WORKSPACES:
          return await this.handleGetDeletedWorkspaces();
        case MessageType.RESTORE_DELETED_WORKSPACES:
          return await this.handleRestoreDeletedWorkspaces(message.payload);
        case MessageType.PERMANENTLY_DELETE_WORKSPACES:
          return await this.handlePermanentlyDeleteWorkspaces(message.payload);
        default:
          return { success: false, error: `Unknown message type: ${(message as any).type}` };
      }
    } catch (error) {
      console.error('[TabFlow] Error handling message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get all workspaces with their tab counts.
   * For the active workspace, uses actual Chrome tab count from the
   * main window instead of storage count (which may include stale records).
   */
  private async handleGetWorkspaces(): Promise<Response> {
    const workspaces = await this.engine.getWorkspaces(LOCAL_USER_ID);
    const activeWorkspace = workspaces.find((ws) => ws.isActive);

    // Try to get the real Chrome tab count for the active workspace
    let realTabCount: number | null = null;
    if (activeWorkspace) {
      try {
        const mainWindowId = await this.tabManager.getMainWindowId();
        if (mainWindowId !== undefined) {
          const chromeTabs = await chrome.tabs.query({ windowId: mainWindowId });
          // Count only trackable tabs (exclude the TabFlow pinned tab itself)
          realTabCount = chromeTabs.filter(
            (t) => t.url && this.tabManager.isTrackableUrl(t.url)
          ).length;
        }
      } catch {
        // Fall back to storage count
      }
    }

    // Enrich each workspace with its tab count.
    // READ ONLY — never delete records here. Storage is the source of truth.
    const withCounts = await Promise.all(
      workspaces.map(async (ws) => {
        if (ws.isActive && realTabCount !== null) {
          return { ...ws, tabCount: realTabCount };
        }
        const tabs = await this.storage.getTabs(ws.id);
        return { ...ws, tabCount: tabs.length };
      })
    );

    return { success: true, data: { workspaces: withCounts } };
  }

  /**
   * Create a new workspace (does NOT auto-switch to it).
   * The user clicks on it in the sidebar to switch, which uses the
   * proper handleSwitchWorkspace flow with hidden windows.
   * Auto-switching was buggy because it didn't move existing tabs
   * to a hidden window, so they'd leak into the new workspace.
   */
  private async handleCreateWorkspace(payload: any): Promise<Response> {
    const { name, color } = payload || {};
    const workspaces = await this.engine.getWorkspaces(LOCAL_USER_ID);
    const pickColor = color || DEFAULT_COLORS[workspaces.length % DEFAULT_COLORS.length];

    // Create the new workspace (inactive — user clicks to switch)
    const workspace = await this.engine.createWorkspace(
      LOCAL_USER_ID,
      name || 'New Workspace',
      pickColor
    );

    console.log(`[TabFlow] Created new workspace: ${workspace.id} (not switching yet)`);

    return { success: true, data: workspace };
  }

  /**
   * Delete a workspace — archives it to the recycle bin first so it can be restored.
   * If it was the active workspace, switch to another one.
   */
  private async handleDeleteWorkspace(payload: any): Promise<Response> {
    const { workspaceId } = payload || {};
    if (!workspaceId) return { success: false, error: 'workspaceId is required' };

    const workspaces = await this.engine.getWorkspaces(LOCAL_USER_ID);
    const deletingWorkspace = workspaces.find((ws) => ws.id === workspaceId);

    if (!deletingWorkspace) {
      return { success: false, error: 'Workspace not found' };
    }

    // Archive the workspace and its tabs before deleting
    try {
      const tabs = await this.storage.getTabs(workspaceId);
      const archiveEntry = {
        id: `deleted-${workspaceId}-${Date.now()}`,
        workspace: { ...deletingWorkspace },
        tabs: tabs.map((t) => ({
          url: t.url,
          title: t.title,
          faviconUrl: t.faviconUrl,
          sortOrder: t.sortOrder,
          isPinned: t.isPinned,
        })),
        deletedAt: new Date(),
      };
      await (this.storage as any).archiveWorkspace(archiveEntry);
      console.log(`[TabFlow] Archived workspace ${workspaceId} to recycle bin`);
    } catch (err) {
      console.warn('[TabFlow] Failed to archive workspace (proceeding with delete):', err);
    }

    // Clean up any hidden window for this workspace
    await this.tabManager.cleanupHiddenWindow(workspaceId);

    // Delete the workspace
    await this.engine.deleteWorkspace(workspaceId);
    console.log(`[TabFlow] Deleted workspace: ${workspaceId}`);

    // If the deleted workspace was active, switch to another one
    if (deletingWorkspace.isActive) {
      const remaining = workspaces.filter((ws) => ws.id !== workspaceId);
      if (remaining.length > 0) {
        const nextWorkspace = remaining[0];
        console.log(`[TabFlow] Deleted workspace was active, switching to ${nextWorkspace.id}`);
        await this.engine.setActiveWorkspace(LOCAL_USER_ID, nextWorkspace.id);
      }
    }

    return { success: true, data: { deletedWorkspaceId: workspaceId } };
  }

  /**
   * Get tabs for a workspace from storage.
   * For the ACTIVE workspace, reconcile stored records against real
   * Chrome tabs in the main window — purge any stale records whose
   * Chrome tab no longer exists. This prevents phantom tab counts.
   */
  private async handleGetTabs(payload: any): Promise<Response> {
    const { workspaceId } = payload || {};
    if (!workspaceId) {
      return { success: false, error: 'workspaceId is required' };
    }

    // READ ONLY — return storage records as-is. Never delete during reads.
    // Storage is the source of truth; tab event listeners keep it in sync.
    const tabs = await this.storage.getTabs(workspaceId);
    return { success: true, data: tabs };
  }

  /**
   * Get tabs for the currently active workspace
   */
  private async handleGetActiveWorkspaceTabs(): Promise<Response> {
    const workspaces = await this.engine.getWorkspaces(LOCAL_USER_ID);
    const activeWorkspace = workspaces.find((ws) => ws.isActive);

    if (!activeWorkspace) {
      console.log('[TabFlow] No active workspace found');
      return { success: true, data: [] };
    }

    const tabs = await this.storage.getTabs(activeWorkspace.id);
    return { success: true, data: tabs };
  }

  /**
   * Remove a tab from storage (user clicked X on a tab card in the UI)
   */
  private async handleRemoveTab(payload: any): Promise<Response> {
    const { tabId } = payload || {};
    if (!tabId) return { success: false, error: 'tabId is required' };

    // Delete from storage
    await this.engine.removeTab(tabId);

    // Also close the actual Chrome tab if it's a live tab
    const match = tabId.match(/^chrome-(\d+)$/);
    if (match) {
      const chromeTabId = parseInt(match[1], 10);
      try {
        await chrome.tabs.remove(chromeTabId);
        console.log(`[TabFlow] Removed tab ${tabId} (closed Chrome tab ${chromeTabId})`);
      } catch {
        console.log(`[TabFlow] Removed tab ${tabId} (Chrome tab already closed)`);
      }
    } else {
      console.log(`[TabFlow] Removed tab ${tabId}`);
    }

    return { success: true, data: { removedTabId: tabId } };
  }

  /**
   * Close all tabs in a workspace (user clicked "Close All Tabs" in the UI).
   * 1. Closes actual Chrome tabs in the main window (matching stored IDs)
   * 2. Closes any hidden window for this workspace
   * 3. Deletes all tab records from storage
   */
  private async handleCloseAllTabs(payload: any): Promise<Response> {
    const { workspaceId } = payload || {};
    if (!workspaceId) return { success: false, error: 'workspaceId is required' };

    const tabs = await this.storage.getTabs(workspaceId);
    let closedCount = 0;

    // Step 1: Close actual Chrome tabs that match stored chrome-* IDs
    const chromeIdsToClose: number[] = [];
    for (const tab of tabs) {
      const match = tab.id.match(/^chrome-(\d+)$/);
      if (match) {
        chromeIdsToClose.push(parseInt(match[1], 10));
      }
    }

    if (chromeIdsToClose.length > 0) {
      try {
        // Filter to only tabs that actually exist (avoid errors)
        const existingTabs = await chrome.tabs.query({});
        const existingIds = new Set(existingTabs.map((t) => t.id));
        const validIds = chromeIdsToClose.filter((id) => existingIds.has(id));

        // Don't close the TabFlow pinned tab
        const tabFlowTabId = this.tabManager.getTabFlowTabId();
        const idsToRemove = validIds.filter((id) => id !== tabFlowTabId);

        if (idsToRemove.length > 0) {
          await chrome.tabs.remove(idsToRemove);
          console.log(`[TabFlow] Closed ${idsToRemove.length} actual Chrome tabs`);
        }
      } catch (e) {
        console.warn('[TabFlow] Error closing Chrome tabs:', e);
      }
    }

    // Step 2: Close hidden window for this workspace (if any)
    try {
      await this.tabManager.closeHiddenWindow(workspaceId);
    } catch (e) {
      console.warn('[TabFlow] Error closing hidden window:', e);
    }

    // Step 3: Delete all tab records from storage
    for (const tab of tabs) {
      await this.storage.deleteTab(tab.id);
      closedCount++;
    }

    console.log(`[TabFlow] Closed all ${closedCount} tabs in workspace ${workspaceId}`);
    return { success: true, data: { closedCount } };
  }

  /**
   * Move tabs from one workspace to another.
   *
   * After updating the workspaceId in storage, we must also close the
   * actual Chrome tabs from the main window. Otherwise the workspace-switch
   * flow's saveCurrentTabsToWorkspace will re-save them under the old
   * workspace, effectively undoing the move.
   */
  private async handleMoveTabs(payload: any): Promise<Response> {
    const { tabIds, targetWorkspaceId } = payload || {};
    if (!tabIds?.length) return { success: false, error: 'tabIds is required' };
    if (!targetWorkspaceId) return { success: false, error: 'targetWorkspaceId is required' };

    // Verify target workspace exists
    const targetWorkspace = await this.storage.getWorkspace(targetWorkspaceId);
    if (!targetWorkspace) return { success: false, error: 'Target workspace not found' };

    // Get all workspaces to find which ones contain these tabs
    const allWorkspaces = await this.storage.getWorkspaces(LOCAL_USER_ID);
    const tabIdSet = new Set(tabIds as string[]);
    let movedCount = 0;
    const chromeTabIdsToClose: number[] = [];

    for (const ws of allWorkspaces) {
      const wsTabs = await this.storage.getTabs(ws.id);
      for (const tab of wsTabs) {
        if (tabIdSet.has(tab.id)) {
          tab.workspaceId = targetWorkspaceId;
          tab.updatedAt = new Date();
          await this.storage.saveTab(tab);
          movedCount++;

          // Extract the Chrome tab ID so we can close it from the main window
          const match = tab.id.match(/^chrome-(\d+)$/);
          if (match) {
            chromeTabIdsToClose.push(parseInt(match[1], 10));
          }
        }
      }
    }

    console.log(`[TabFlow] Moved ${movedCount} tabs to workspace ${targetWorkspaceId}`);
    // Return the Chrome tab IDs so the service worker can close them
    // (it has direct access to recentlyRemovedTabs and isSwitchingWorkspaces)
    return { success: true, data: { movedCount, targetWorkspaceId, chromeTabIdsToClose } };
  }

  /**
   * Rename a workspace
   */
  private async handleRenameWorkspace(payload: any): Promise<Response> {
    const { workspaceId, name } = payload || {};
    if (!workspaceId) return { success: false, error: 'workspaceId is required' };
    if (!name?.trim()) return { success: false, error: 'name is required' };

    await this.engine.renameWorkspace(workspaceId, name.trim());
    console.log(`[TabFlow] Renamed workspace ${workspaceId} to "${name.trim()}"`);
    return { success: true, data: { workspaceId, name: name.trim() } };
  }

  /**
   * Change a workspace's color
   */
  private async handleChangeWorkspaceColor(payload: any): Promise<Response> {
    const { workspaceId, color } = payload || {};
    if (!workspaceId) return { success: false, error: 'workspaceId is required' };
    if (!color) return { success: false, error: 'color is required' };

    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };

    workspace.color = color;
    workspace.updatedAt = new Date();
    workspace.version++;
    await this.storage.saveWorkspace(workspace);

    console.log(`[TabFlow] Changed workspace ${workspaceId} color to ${color}`);
    return { success: true, data: { workspaceId, color } };
  }

  /**
   * Change a workspace's short name (1-3 chars shown on pinned tab favicon).
   * Pass an empty string to clear and revert to auto-generated initials.
   */
  private async handleChangeWorkspaceShortName(payload: any): Promise<Response> {
    const { workspaceId, shortName } = payload || {};
    if (!workspaceId) return { success: false, error: 'workspaceId is required' };
    if (shortName === undefined) return { success: false, error: 'shortName is required' };

    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) return { success: false, error: 'Workspace not found' };

    // Allow empty string to clear, otherwise limit to 3 chars
    workspace.shortName = shortName ? shortName.substring(0, 3) : undefined;
    workspace.updatedAt = new Date();
    workspace.version++;
    await this.storage.saveWorkspace(workspace);

    console.log(`[TabFlow] Changed workspace ${workspaceId} shortName to "${workspace.shortName || '(auto)'}"`);
    return { success: true, data: { workspaceId, shortName: workspace.shortName } };
  }

  /**
   * Reorder workspaces by updating their sortOrder values
   * Expects an array of { id, sortOrder } objects
   */
  private async handleReorderWorkspaces(payload: any): Promise<Response> {
    const { orderedIds } = payload || {};
    if (!orderedIds || !Array.isArray(orderedIds)) {
      return { success: false, error: 'orderedIds array is required' };
    }

    const workspaces = await this.engine.getWorkspaces(LOCAL_USER_ID);

    for (let i = 0; i < orderedIds.length; i++) {
      const ws = workspaces.find((w) => w.id === orderedIds[i]);
      if (ws) {
        ws.sortOrder = i;
        ws.updatedAt = new Date();
        ws.version++;
        await this.storage.saveWorkspace(ws);
      }
    }

    console.log(`[TabFlow] Reordered ${orderedIds.length} workspaces`);
    return { success: true, data: { orderedIds } };
  }

  /**
   * Switch to a different workspace
   *
   * HIDDEN WINDOW MODEL (preserves full tab state):
   * 1. Save current tabs to storage (for sync/recovery)
   * 2. Move current tabs to a minimized hidden window
   * 3. Try to restore target workspace from its hidden window
   * 4. If no hidden window exists, fall back to suspended tab creation
   *
   * This preserves video playback position, scroll position, form data,
   * and all other DOM state across workspace switches.
   */
  private async handleSwitchWorkspace(payload: any): Promise<Response> {
    const { workspaceId } = payload || {};
    if (!workspaceId) return { success: false, error: 'workspaceId is required' };

    try {
      console.log(`[TabFlow] Starting workspace switch to ${workspaceId}`);

      // Signal to service worker that we're switching workspaces
      this.onSwitchingWorkspacesChange?.(true);

      try {
        // Step 1: Get workspaces
        const workspaces = await this.engine.getWorkspaces(LOCAL_USER_ID);
        const currentActiveWorkspace = workspaces.find((ws) => ws.isActive);
        const targetWorkspace = workspaces.find((ws) => ws.id === workspaceId);

        if (!targetWorkspace) {
          return { success: false, error: 'Target workspace not found' };
        }

        // IMPORTANT: Capture the main window ID NOW, before any tab moves.
        // After moveTabsToHiddenWindow runs, the service worker may lose
        // track of the "current window" — causing "No current window" errors
        // when trying to create tabs later.
        const mainWindowId = await this.tabManager.getMainWindowId();
        if (mainWindowId === undefined) {
          console.error('[TabFlow] Cannot switch workspace — main window not found');
          return { success: false, error: 'Main window not found' };
        }
        console.log(`[TabFlow] Main window ID captured: ${mainWindowId}`);

        // Step 2: Save current tabs to storage (needed for sync and fallback).
        // CRITICAL: Pass the explicit mainWindowId. Using currentWindow in a
        // service worker means "last focused window" which can be WRONG during
        // workspace switches (e.g., if a hidden window briefly gets focus).
        //
        // EXCEPTION: After Chrome restart, skip this save. Chrome restores tabs
        // from its own session which may not match our active workspace. The
        // restart-* records in the DB are the source of truth — don't overwrite them.
        // Check if this is a post-restart switch (tabs in window are untrustworthy)
        const isPostRestartSwitch = this.skipOutgoingSaveOnNextSwitch;
        if (isPostRestartSwitch) {
          this.skipOutgoingSaveOnNextSwitch = false;
        }

        if (currentActiveWorkspace) {
          if (isPostRestartSwitch) {
            console.log(`[TabFlow] SKIPPING outgoing save for ${currentActiveWorkspace.id} (post-restart — tabs may not match workspace)`);
          } else {
            console.log(`[TabFlow] Saving tabs from ${currentActiveWorkspace.id} (window ${mainWindowId})`);
            await this.tabManager.saveCurrentTabsToWorkspace(currentActiveWorkspace.id, this.storage, mainWindowId);
          }
        }

        // Step 3: Update workspace active status
        if (currentActiveWorkspace && currentActiveWorkspace.id !== workspaceId) {
          currentActiveWorkspace.isActive = false;
          currentActiveWorkspace.updatedAt = new Date();
          currentActiveWorkspace.version++;
          await this.storage.saveWorkspace(currentActiveWorkspace);
        }

        targetWorkspace.isActive = true;
        targetWorkspace.updatedAt = new Date();
        targetWorkspace.version++;
        await this.storage.saveWorkspace(targetWorkspace);
        console.log(`[TabFlow] Workspace ${workspaceId} is now active`);

        // Step 4: Move current tabs to a hidden window (preserves state)
        // EXCEPTION: After Chrome restart, DON'T move to hidden window — the
        // tabs in the main window may not belong to the outgoing workspace.
        // Just close them so they don't pollute future switches.
        if (currentActiveWorkspace) {
          if (isPostRestartSwitch) {
            console.log(`[TabFlow] Post-restart: closing orphan tabs instead of hiding (they may not belong to ${currentActiveWorkspace.id})`);
            await this.tabManager.closeAllTabs();
          } else {
            const moved = await this.tabManager.moveTabsToHiddenWindow(currentActiveWorkspace.id);
            if (!moved) {
              console.warn('[TabFlow] Hidden window move failed, falling back to close');
              try {
                const checkWindow = await chrome.windows.get(mainWindowId);
                if (checkWindow) {
                  await this.tabManager.closeAllTabs();
                } else {
                  console.error('[TabFlow] Main window no longer exists after failed move');
                }
              } catch {
                console.error('[TabFlow] Main window no longer exists after failed move — skipping closeAllTabs');
              }
            }
          }
        }

        // Step 5: Try to restore from hidden window (preserves full state)
        const restored = await this.tabManager.restoreTabsFromHiddenWindow(workspaceId);

        if (!restored) {
          // No hidden window — fall back to suspended tabs
          // This happens on first switch after browser restart or for new workspaces
          console.log('[TabFlow] No hidden window found, using suspended tab fallback');
          const tabsToRestore = await this.storage.getTabs(workspaceId);
          // Pass the pre-captured mainWindowId so tabs are created in the right window
          await this.tabManager.restoreWorkspaceTabs(tabsToRestore, this.storage, mainWindowId);
        } else {
          // Tabs restored from hidden window — but there may also be moved-*
          // or dup-* records in storage that need to be materialized as Chrome
          // tabs since they weren't in the hidden window.
          console.log('[TabFlow] Tabs restored from hidden window with full state preserved');
          const storedTabs = await this.storage.getTabs(workspaceId);
          const pendingTabs = storedTabs.filter((t) => t.id.startsWith('moved-') || t.id.startsWith('dup-'));
          if (pendingTabs.length > 0) {
            console.log(`[TabFlow] Also restoring ${pendingTabs.length} pending tab(s) not in hidden window`);
            await this.tabManager.restoreWorkspaceTabs(pendingTabs, this.storage, mainWindowId);
          }
        }

        console.log(`[TabFlow] Workspace switch completed`);

        // Re-verify the TabFlow tab is still pinned at index 0.
        // Tab moves can displace or unpin it.
        try {
          const stored = await chrome.storage.local.get('tabFlowTabId');
          if (stored.tabFlowTabId) {
            const tfTab = await chrome.tabs.get(stored.tabFlowTabId);
            if (tfTab) {
              if (!tfTab.pinned) {
                await chrome.tabs.update(tfTab.id!, { pinned: true });
                console.log('[TabFlow] Re-pinned TabFlow tab after workspace switch');
              }
              if (tfTab.index !== 0) {
                await chrome.tabs.move(tfTab.id!, { index: 0 });
                console.log('[TabFlow] Re-positioned TabFlow tab to index 0 after workspace switch');
              }
            }
          }
        } catch (e) {
          console.warn('[TabFlow] Could not verify TabFlow tab after switch:', e);
        }

        // Brief delay for Chrome's tab events to settle
        await new Promise((resolve) => setTimeout(resolve, 300));

        // CRITICAL: After tabs are restored, save the target workspace's
        // current Chrome tabs to storage. This ensures storage reflects the
        // ACTUAL tabs in the window, not stale records from a previous switch.
        // Without this, the UI tiles show old data until a manual refresh.
        await this.tabManager.saveCurrentTabsToWorkspace(workspaceId, this.storage, mainWindowId);
        console.log(`[TabFlow] Saved fresh tab snapshot for target workspace ${workspaceId}`);

        // Notify UI to refresh with the updated data
        try {
          await chrome.storage.session.set({ syncUpdateTs: Date.now() });
        } catch { /* session storage not available */ }

        return { success: true, data: { activeWorkspaceId: workspaceId } };
      } finally {
        this.onSwitchingWorkspacesChange?.(false);
      }
    } catch (error) {
      console.error('[TabFlow] Error during workspace switch:', error);
      this.onSwitchingWorkspacesChange?.(false);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to switch workspace',
      };
    }
  }

  /**
   * Save current state as a named session
   */
  private async handleSaveSession(payload: any): Promise<Response> {
    const { sessionName } = payload || {};
    if (!sessionName) return { success: false, error: 'sessionName is required' };

    const session = await this.engine.saveSession(LOCAL_USER_ID, sessionName);
    return { success: true, data: session };
  }

  /**
   * Restore a saved session
   */
  private async handleRestoreSession(payload: any): Promise<Response> {
    const { sessionId } = payload || {};
    if (!sessionId) return { success: false, error: 'sessionId is required' };

    await this.engine.restoreSession(sessionId);
    return { success: true, data: { restored: true } };
  }

  // ==================== WORKSPACE HISTORY HANDLERS ====================

  /**
   * Get history entries for a workspace (newest first).
   * Payload: { workspaceId: string, limit?: number }
   */
  private async handleGetWorkspaceHistory(payload: any): Promise<Response> {
    const { workspaceId, limit } = payload || {};
    if (!workspaceId) return { success: false, error: 'workspaceId is required' };

    const entries = await this.storage.getHistory(workspaceId, limit || 100);
    return { success: true, data: entries };
  }

  /**
   * Restore a workspace to a previous history entry.
   * Replaces the workspace's current tabs with the tabs from the history entry.
   * This is an explicit user action, so it DOES modify the database.
   *
   * Payload: { workspaceId: string, entryId: string }
   */
  private async handleRestoreHistoryEntry(payload: any): Promise<Response> {
    const { workspaceId, entryId } = payload || {};
    if (!workspaceId) return { success: false, error: 'workspaceId is required' };
    if (!entryId) return { success: false, error: 'entryId is required' };

    // Find the history entry
    const allEntries = await this.storage.getHistory(workspaceId, 1000);
    const entry = allEntries.find((e) => e.id === entryId);
    if (!entry) return { success: false, error: 'History entry not found' };

    // Check if this workspace is the currently active one
    const workspaces = await this.storage.getWorkspaces(LOCAL_USER_ID);
    const isActive = workspaces.find((ws) => ws.id === workspaceId)?.isActive ?? false;

    // Delete existing tabs for this workspace
    const existingTabs = await this.storage.getTabs(workspaceId);
    for (const tab of existingTabs) {
      await this.storage.deleteTab(tab.id);
    }

    // Create new tab records from the history entry
    const now = new Date();
    const newTabs = entry.tabs.map((ht) => ({
      id: crypto.randomUUID(),
      workspaceId,
      url: ht.url,
      title: ht.title,
      faviconUrl: ht.faviconUrl,
      sortOrder: ht.sortOrder,
      isPinned: ht.isPinned,
      lastAccessed: now,
      updatedAt: now,
    }));
    await this.storage.saveTabs(newTabs);

    console.log(`[TabFlow] Restored workspace ${workspaceId} to history entry ${entryId} (${newTabs.length} tabs)`);

    // If this is the active workspace, also restore the actual Chrome tabs
    if (isActive) {
      try {
        const mainWindowId = await this.tabManager.getMainWindowId();
        if (mainWindowId !== undefined) {
          // Close existing workspace tabs (not the pinned TabFlow tab)
          const chromeTabs = await chrome.tabs.query({ windowId: mainWindowId });
          const tabsToClose = chromeTabs.filter((ct) => !ct.pinned && ct.url !== 'chrome://newtab/');
          if (tabsToClose.length > 0) {
            await chrome.tabs.remove(tabsToClose.map((ct) => ct.id!));
          }

          // Open the restored tabs
          await this.tabManager.restoreWorkspaceTabs(newTabs, this.storage, mainWindowId);
          console.log('[TabFlow] Active workspace tabs restored in browser');
        }
      } catch (err) {
        console.warn('[TabFlow] Could not restore active workspace tabs in browser:', err);
      }
    }

    // Notify UI to refresh
    try {
      await chrome.storage.session.set({ syncUpdateTs: Date.now() });
    } catch { /* session storage not available */ }

    return { success: true, data: { restoredTabs: newTabs.length } };
  }

  // ==================== SEARCH ====================

  /**
   * Search tab titles and URLs across ALL workspaces.
   * Returns matching tabs annotated with their workspace name and color.
   * Payload: { query: string, limit?: number }
   */
  private async handleSearchAllWorkspaces(payload: any): Promise<Response> {
    const { query, limit } = payload || {};
    if (!query || typeof query !== 'string') {
      return { success: true, data: [] };
    }

    const needle = query.toLowerCase().trim();
    if (needle.length === 0) return { success: true, data: [] };

    const workspaces = await this.engine.getWorkspaces(LOCAL_USER_ID);
    const results: Array<{
      tab: { id: string; url: string; title: string; faviconUrl?: string; workspaceId: string };
      workspace: { id: string; name: string; color?: string; isActive: boolean };
    }> = [];

    const maxResults = limit || 30;

    for (const ws of workspaces) {
      if (results.length >= maxResults) break;

      const tabs = await this.storage.getTabs(ws.id);
      for (const tab of tabs) {
        if (results.length >= maxResults) break;

        const titleMatch = tab.title?.toLowerCase().includes(needle);
        const urlMatch = tab.url?.toLowerCase().includes(needle);

        if (titleMatch || urlMatch) {
          results.push({
            tab: {
              id: tab.id,
              url: tab.url,
              title: tab.title,
              faviconUrl: tab.faviconUrl,
              workspaceId: tab.workspaceId,
            },
            workspace: {
              id: ws.id,
              name: ws.name,
              color: ws.color,
              isActive: ws.isActive,
            },
          });
        }
      }
    }

    return { success: true, data: results };
  }

  /**
   * Find and activate an existing Chrome tab by URL in the main window.
   * Uses loose matching (origin+pathname) to handle query param differences.
   * Returns { found: true, tabId } if activated, or { found: false } if not.
   *
   * Payload: { url: string }
   */
  /**
   * Reorder tabs in both Chrome and storage.
   * Payload: { orderedTabIds: string[] } — tab IDs in the desired order.
   *
   * The tab IDs are TabFlow IDs like "chrome-12345". We extract the Chrome
   * tab IDs and call chrome.tabs.move to reposition them in the browser,
   * then update sortOrder in storage to persist the order.
   */
  private async handleReorderTabs(payload: any): Promise<Response> {
    const { orderedTabIds } = payload || {};
    if (!orderedTabIds?.length) return { success: false, error: 'orderedTabIds is required' };

    try {
      const mainWindowId = await this.tabManager.getMainWindowId();
      if (mainWindowId === undefined) {
        return { success: false, error: 'Main window not found' };
      }

      // The TabFlow pinned tab is always at index 0.
      // Workspace tabs start at index 1.
      const startIndex = 1;

      // Move Chrome tabs to match the new order
      for (let i = 0; i < orderedTabIds.length; i++) {
        const tabId = orderedTabIds[i] as string;
        const match = tabId.match(/^chrome-(\d+)$/);
        if (match) {
          const chromeTabId = parseInt(match[1], 10);
          try {
            await chrome.tabs.move(chromeTabId, { index: startIndex + i });
          } catch {
            // Tab may have been closed — skip
          }
        }
      }

      // Update sortOrder in storage
      const workspaces = await this.storage.getWorkspaces('local-user');
      const activeWorkspace = workspaces.find((ws) => ws.isActive);
      if (activeWorkspace) {
        for (let i = 0; i < orderedTabIds.length; i++) {
          const tabs = await this.storage.getTabs(activeWorkspace.id);
          const tab = tabs.find((t) => t.id === orderedTabIds[i]);
          if (tab) {
            tab.sortOrder = i;
            tab.updatedAt = new Date();
            await this.storage.saveTab(tab);
          }
        }
      }

      console.log(`[TabFlow] Reordered ${orderedTabIds.length} tabs`);
      return { success: true };
    } catch (error) {
      console.error('[TabFlow] Error reordering tabs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reorder tabs',
      };
    }
  }

  private async handleActivateTabByUrl(payload: any): Promise<Response> {
    const { url } = payload || {};
    if (!url) return { success: false, error: 'url is required' };

    try {
      const mainWindowId = await this.tabManager.getMainWindowId();
      if (mainWindowId === undefined) {
        console.log('[TabFlow] ACTIVATE_TAB_BY_URL: no main window');
        return { success: true, data: { found: false } };
      }

      const windowTabs = await chrome.tabs.query({ windowId: mainWindowId });
      console.log(`[TabFlow] ACTIVATE_TAB_BY_URL: searching ${windowTabs.length} tabs in window ${mainWindowId} for "${url}"`);

      // Parse the target URL for loose matching
      let targetOrigin = '';
      let targetPathname = '';
      try {
        const parsed = new URL(url);
        targetOrigin = parsed.origin;
        targetPathname = parsed.pathname;
      } catch {
        // If URL can't be parsed, fall through to exact match only
      }

      // Helper: extract the real URL from a suspended tab URL
      const suspendedPrefix = `chrome-extension://${chrome.runtime.id}/suspended.html`;
      const getRealUrl = (tabUrl: string): string => {
        if (tabUrl.startsWith(suspendedPrefix)) {
          try {
            return new URL(tabUrl).searchParams.get('url') || tabUrl;
          } catch { return tabUrl; }
        }
        return tabUrl;
      };

      // Pass 1: exact match (direct URL or real URL extracted from suspended)
      for (const tab of windowTabs) {
        if (!tab.url || !tab.id) continue;
        const realUrl = getRealUrl(tab.url);
        if (realUrl === url) {
          await chrome.tabs.update(tab.id, { active: true });
          console.log(`[TabFlow] ACTIVATE_TAB_BY_URL: exact match tab ${tab.id} (url: ${tab.url})`);
          return { success: true, data: { found: true, tabId: tab.id } };
        }
      }

      // Pass 2: loose match (same origin + pathname, ignore query/hash)
      if (targetOrigin) {
        for (const tab of windowTabs) {
          if (!tab.url || !tab.id) continue;
          const realUrl = getRealUrl(tab.url);
          try {
            const tabUrl = new URL(realUrl);
            if (tabUrl.origin === targetOrigin && tabUrl.pathname === targetPathname) {
              await chrome.tabs.update(tab.id, { active: true });
              console.log(`[TabFlow] ACTIVATE_TAB_BY_URL: loose match tab ${tab.id} (${realUrl})`);
              return { success: true, data: { found: true, tabId: tab.id } };
            }
          } catch { continue; }
        }
      }

      // Log all tab URLs for debugging
      console.log(`[TabFlow] ACTIVATE_TAB_BY_URL: no match for "${url}" among tabs:`);
      for (const tab of windowTabs.slice(0, 10)) {
        const realUrl = getRealUrl(tab.url || '');
        console.log(`  - tab ${tab.id}: ${realUrl}${tab.url !== realUrl ? ' (suspended)' : ''}`);
      }
      if (windowTabs.length > 10) {
        console.log(`  ... and ${windowTabs.length - 10} more`);
      }

      return { success: true, data: { found: false } };
    } catch (err) {
      console.error('[TabFlow] ACTIVATE_TAB_BY_URL error:', err);
      return { success: true, data: { found: false } };
    }
  }

  // ==================== DELETED WORKSPACES (ARCHIVE) HANDLERS ====================

  /**
   * Get all archived (deleted) workspaces.
   */
  private async handleGetDeletedWorkspaces(): Promise<Response> {
    try {
      const deleted = await (this.storage as any).getDeletedWorkspaces();
      return { success: true, data: deleted || [] };
    } catch (err) {
      console.error('[TabFlow] Failed to get deleted workspaces:', err);
      return { success: true, data: [] };
    }
  }

  /**
   * Restore selected deleted workspaces from the archive.
   * Recreates the workspace and all its tabs in storage.
   */
  private async handleRestoreDeletedWorkspaces(payload: any): Promise<Response> {
    const { archiveIds } = payload || {};
    if (!archiveIds || !Array.isArray(archiveIds) || archiveIds.length === 0) {
      return { success: false, error: 'archiveIds is required (array of archive entry IDs)' };
    }

    const storageAny = this.storage as any;
    const allDeleted = await storageAny.getDeletedWorkspaces();
    let restoredCount = 0;

    // Get existing workspaces to determine max sortOrder
    const existingWorkspaces = await this.engine.getWorkspaces(LOCAL_USER_ID);
    let maxSortOrder = existingWorkspaces.reduce(
      (max, ws) => Math.max(max, ws.sortOrder),
      -1
    );

    for (const archiveId of archiveIds) {
      const entry = allDeleted.find((d: any) => d.id === archiveId);
      if (!entry) continue;

      // Generate a new ID for the restored workspace (avoid collisions)
      const newWorkspaceId = crypto.randomUUID();
      maxSortOrder += 1;

      // Recreate the workspace
      const restoredWorkspace = {
        ...entry.workspace,
        id: newWorkspaceId,
        isActive: false,
        sortOrder: maxSortOrder,
        updatedAt: new Date(),
        version: 1,
      };
      await this.storage.saveWorkspace(restoredWorkspace);

      // Recreate all tabs
      for (const tab of entry.tabs) {
        const newTab = {
          id: crypto.randomUUID(),
          workspaceId: newWorkspaceId,
          url: tab.url,
          title: tab.title,
          faviconUrl: tab.faviconUrl,
          sortOrder: tab.sortOrder,
          isPinned: tab.isPinned,
          lastAccessed: new Date(),
          updatedAt: new Date(),
        };
        await this.storage.saveTab(newTab);
      }

      // Remove from archive
      await storageAny.permanentlyDeleteWorkspace(archiveId);
      restoredCount++;
      console.log(`[TabFlow] Restored workspace "${entry.workspace.name}" as ${newWorkspaceId}`);
    }

    return { success: true, data: { restoredCount } };
  }

  /**
   * Permanently delete selected workspaces from the archive (empty recycle bin).
   */
  private async handlePermanentlyDeleteWorkspaces(payload: any): Promise<Response> {
    const { archiveIds } = payload || {};
    if (!archiveIds || !Array.isArray(archiveIds) || archiveIds.length === 0) {
      return { success: false, error: 'archiveIds is required' };
    }

    const storageAny = this.storage as any;
    let deletedCount = 0;

    for (const archiveId of archiveIds) {
      try {
        await storageAny.permanentlyDeleteWorkspace(archiveId);
        deletedCount++;
      } catch (err) {
        console.warn(`[TabFlow] Failed to permanently delete archive ${archiveId}:`, err);
      }
    }

    console.log(`[TabFlow] Permanently deleted ${deletedCount} archived workspace(s)`);
    return { success: true, data: { deletedCount } };
  }
}
