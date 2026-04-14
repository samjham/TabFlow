/**
 * React hook for communicating with the TabFlow background service worker.
 * Provides workspace and tab operations via Chrome message passing.
 */

import { useState, useEffect, useCallback } from 'react';
import { MessageType } from '../background/MessageHandler';
import type { Workspace, Tab } from '@tabflow/core';

/** Workspace with its tab count for display in the popup */
export interface WorkspaceWithCount extends Workspace {
  tabCount: number;
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

/** Hook return type */
interface UseTabFlowReturn {
  workspaces: WorkspaceWithCount[];
  loading: boolean;
  error: string | null;
  createWorkspace: (name: string, color: string) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  addCurrentTab: (workspaceId: string) => Promise<void>;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Main hook for TabFlow popup/sidebar state management.
 * Loads workspaces on mount, provides actions that message the background worker.
 */
export function useTabFlow(): UseTabFlowReturn {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetch workspaces and their tab counts from the background */
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await sendMessage<{ workspaces: WorkspaceWithCount[] }>(
        MessageType.GET_WORKSPACES
      );
      setWorkspaces(data.workspaces || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createWorkspace = useCallback(async (name: string, color: string) => {
    try {
      await sendMessage(MessageType.CREATE_WORKSPACE, { name, color });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    }
  }, [refresh]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await sendMessage(MessageType.DELETE_WORKSPACE, { workspaceId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workspace');
    }
  }, [refresh]);

  const addCurrentTab = useCallback(async (workspaceId: string) => {
    try {
      await sendMessage(MessageType.ADD_CURRENT_TAB, { workspaceId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add tab');
    }
  }, [refresh]);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    try {
      await sendMessage(MessageType.SWITCH_WORKSPACE, { workspaceId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch workspace');
    }
  }, [refresh]);

  return {
    workspaces,
    loading,
    error,
    createWorkspace,
    deleteWorkspace,
    addCurrentTab,
    switchWorkspace,
    refresh,
  };
}
