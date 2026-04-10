/**
 * React hook for managing workspace state in the New Tab page.
 * Fetches workspaces and their tabs via chrome.runtime.sendMessage.
 * Provides actions to create, delete, and switch workspaces.
 *
 * PERFORMANCE MODEL:
 * - Initial load shows a loading spinner (loading = true)
 * - Subsequent refreshes (from SYNC_UPDATE) update data silently
 *   without flashing a loading state, so tab cards stay visible.
 * - SYNC_UPDATE is debounced (200ms) so rapid-fire onUpdated events
 *   (title, favicon, status changes) collapse into a single refresh.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageType } from '../background/MessageHandler';
import type { Workspace, Tab, WorkspaceHistoryEntry } from '@tabflow/core';

/** Workspace with its tab count for display */
export interface WorkspaceWithCount extends Workspace {
  tabCount: number;
}

/** A search result: a tab annotated with its parent workspace */
export interface SearchResult {
  tab: { id: string; url: string; title: string; faviconUrl?: string; workspaceId: string };
  workspace: { id: string; name: string; color?: string; isActive: boolean };
}

/** Hook return type */
export interface UseWorkspacesReturn {
  workspaces: WorkspaceWithCount[];
  activeWorkspace: WorkspaceWithCount | null;
  tabs: Tab[];
  loading: boolean;
  error: string | null;
  createWorkspace: (name: string, color: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  changeWorkspaceColor: (workspaceId: string, color: string) => Promise<void>;
  reorderWorkspaces: (orderedIds: string[]) => Promise<void>;
  changeShortName: (workspaceId: string, shortName: string) => Promise<void>;
  removeTab: (tabId: string) => Promise<void>;
  removeTabs: (tabIds: string[]) => Promise<void>;
  moveTabs: (tabIds: string[], targetWorkspaceId: string) => Promise<void>;
  duplicateTabs: (tabIds: string[], targetWorkspaceId: string) => Promise<void>;
  getWorkspaceHistory: (workspaceId: string, limit?: number) => Promise<WorkspaceHistoryEntry[]>;
  restoreHistoryEntry: (workspaceId: string, entryId: string) => Promise<void>;
  searchAllWorkspaces: (query: string) => Promise<SearchResult[]>;
  closeAllTabs: (workspaceId: string) => Promise<void>;
  reorderTabs: (orderedTabIds: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

/** Send a typed message to the background service worker */
async function sendMessage<T = any>(type: MessageType, payload?: any): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.success) {
        resolve(response.data as T);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  });
}

/**
 * Hook for managing workspaces and tabs in the New Tab page.
 * Loads workspaces on mount, provides actions via background messaging.
 */
export function useWorkspaces(): UseWorkspacesReturn {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithCount[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track whether initial load is done — subsequent refreshes don't flash loading
  const initialLoadDone = useRef(false);

  // Debounce timer for SYNC_UPDATE
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeWorkspace = workspaces.find((ws) => ws.isActive) || null;

  /** Fetch workspaces and tabs from the background */
  const refresh = useCallback(async () => {
    try {
      // Only show loading spinner on the very first load
      if (!initialLoadDone.current) {
        setLoading(true);
      }
      setError(null);

      // Get all workspaces
      const workspacesData = await sendMessage<{ workspaces: WorkspaceWithCount[] }>(
        MessageType.GET_WORKSPACES
      );
      setWorkspaces(workspacesData.workspaces || []);

      // Get tabs for the active workspace
      const active = (workspacesData.workspaces || []).find((ws) => ws.isActive);
      if (active) {
        const tabsData = await sendMessage<Tab[]>(MessageType.GET_TABS, {
          workspaceId: active.id,
        });
        setTabs(tabsData || []);
      } else {
        setTabs([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
      initialLoadDone.current = true;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Listen for data changes from the service worker.
   *
   * Uses chrome.storage.onChanged instead of chrome.runtime.onMessage
   * because sendMessage is unreliable for reaching pinned newtab pages
   * in the background. storage.onChanged fires reliably in ALL contexts.
   *
   * Debounced at 200ms so rapid-fire tab events (onUpdated fires
   * multiple times per tab load) collapse into a single UI refresh.
   */
  useEffect(() => {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      // Only respond to our sync notification in session storage
      if (areaName !== 'session' || !changes.syncUpdateTs) return;

      // Clear any pending debounce
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
      // Schedule a refresh after 200ms of quiet
      debounceTimer.current = setTimeout(() => {
        refresh();
      }, 200);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [refresh]);

  const createWorkspace = useCallback(
    async (name: string, color: string) => {
      try {
        await sendMessage(MessageType.CREATE_WORKSPACE, { name, color });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create workspace');
        throw err;
      }
    },
    [refresh]
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        await sendMessage(MessageType.DELETE_WORKSPACE, { workspaceId });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete workspace');
        throw err;
      }
    },
    [refresh]
  );

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      try {
        await sendMessage(MessageType.SWITCH_WORKSPACE, { workspaceId });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to switch workspace');
        throw err;
      }
    },
    [refresh]
  );

  const removeTab = useCallback(
    async (tabId: string) => {
      try {
        await sendMessage(MessageType.REMOVE_TAB, { tabId });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove tab');
        throw err;
      }
    },
    [refresh]
  );

  const removeTabs = useCallback(
    async (tabIds: string[]) => {
      try {
        for (const tabId of tabIds) {
          await sendMessage(MessageType.REMOVE_TAB, { tabId });
        }
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove tabs');
        throw err;
      }
    },
    [refresh]
  );

  const duplicateTabs = useCallback(
    async (tabIds: string[], targetWorkspaceId: string) => {
      try {
        await sendMessage(MessageType.DUPLICATE_TABS, { tabIds, targetWorkspaceId });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to duplicate tabs');
        throw err;
      }
    },
    [refresh]
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      try {
        await sendMessage(MessageType.RENAME_WORKSPACE, { workspaceId, name });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to rename workspace');
        throw err;
      }
    },
    [refresh]
  );

  const changeWorkspaceColor = useCallback(
    async (workspaceId: string, color: string) => {
      try {
        await sendMessage(MessageType.CHANGE_WORKSPACE_COLOR, { workspaceId, color });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to change workspace color');
        throw err;
      }
    },
    [refresh]
  );

  const moveTabs = useCallback(
    async (tabIds: string[], targetWorkspaceId: string) => {
      try {
        await sendMessage(MessageType.MOVE_TABS, { tabIds, targetWorkspaceId });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to move tabs');
        throw err;
      }
    },
    [refresh]
  );

  const closeAllTabs = useCallback(
    async (workspaceId: string) => {
      try {
        await sendMessage(MessageType.CLOSE_ALL_TABS, { workspaceId });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to close all tabs');
        throw err;
      }
    },
    [refresh]
  );

  const changeShortName = useCallback(
    async (workspaceId: string, shortName: string) => {
      try {
        await sendMessage(MessageType.CHANGE_WORKSPACE_SHORT_NAME, { workspaceId, shortName });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to change short name');
        throw err;
      }
    },
    [refresh]
  );

  const reorderWorkspaces = useCallback(
    async (orderedIds: string[]) => {
      try {
        await sendMessage(MessageType.REORDER_WORKSPACES, { orderedIds });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reorder workspaces');
        throw err;
      }
    },
    [refresh]
  );

  const searchAllWorkspaces = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      try {
        return await sendMessage<SearchResult[]>(
          MessageType.SEARCH_ALL_WORKSPACES,
          { query }
        );
      } catch (err) {
        return [];
      }
    },
    []
  );

  const getWorkspaceHistory = useCallback(
    async (workspaceId: string, limit?: number): Promise<WorkspaceHistoryEntry[]> => {
      try {
        return await sendMessage<WorkspaceHistoryEntry[]>(
          MessageType.GET_WORKSPACE_HISTORY,
          { workspaceId, limit }
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to get workspace history');
        return [];
      }
    },
    []
  );

  const restoreHistoryEntry = useCallback(
    async (workspaceId: string, entryId: string) => {
      try {
        await sendMessage(MessageType.RESTORE_HISTORY_ENTRY, { workspaceId, entryId });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to restore history entry');
        throw err;
      }
    },
    [refresh]
  );

  const reorderTabs = useCallback(
    async (orderedTabIds: string[]) => {
      try {
        await sendMessage(MessageType.REORDER_TABS, { orderedTabIds });
        // Update local state immediately for snappy UI (optimistic update)
        setTabs((prev) => {
          const tabMap = new Map(prev.map((t) => [t.id, t]));
          return orderedTabIds
            .map((id) => tabMap.get(id))
            .filter((t): t is Tab => t !== undefined);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reorder tabs');
        await refresh();
      }
    },
    [refresh]
  );

  return {
    workspaces,
    activeWorkspace,
    tabs,
    loading,
    error,
    createWorkspace,
    deleteWorkspace,
    switchWorkspace,
    renameWorkspace,
    changeWorkspaceColor,
    reorderWorkspaces,
    removeTab,
    removeTabs,
    moveTabs,
    duplicateTabs,
    closeAllTabs,
    changeShortName,
    getWorkspaceHistory,
    restoreHistoryEntry,
    searchAllWorkspaces,
    reorderTabs,
    refresh,
  };
}
