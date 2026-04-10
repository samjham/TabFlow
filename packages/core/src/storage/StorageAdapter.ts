/**
 * Platform-agnostic storage adapter interface.
 * Implementations can target different storage backends (Supabase, IndexedDB, etc.)
 */

import { Workspace, Tab, Session, WorkspaceHistoryEntry } from '../models/types';

/**
 * Abstract interface for storage operations.
 * Implementations handle persistence of workspaces, tabs, and sessions.
 */
export interface StorageAdapter {
  /**
   * Retrieves all workspaces for a given user.
   * @param userId The ID of the user
   * @returns Promise resolving to an array of workspaces
   */
  getWorkspaces(userId: string): Promise<Workspace[]>;

  /**
   * Retrieves a single workspace by ID.
   * @param id The workspace ID
   * @returns Promise resolving to the workspace or null if not found
   */
  getWorkspace(id: string): Promise<Workspace | null>;

  /**
   * Saves a workspace to storage (creates or updates).
   * @param workspace The workspace to save
   * @returns Promise that resolves when save is complete
   */
  saveWorkspace(workspace: Workspace): Promise<void>;

  /**
   * Deletes a workspace from storage.
   * @param id The workspace ID to delete
   * @returns Promise that resolves when deletion is complete
   */
  deleteWorkspace(id: string): Promise<void>;

  /**
   * Retrieves all tabs in a workspace.
   * @param workspaceId The ID of the workspace
   * @returns Promise resolving to an array of tabs
   */
  getTabs(workspaceId: string): Promise<Tab[]>;

  /**
   * Saves a single tab to storage (creates or updates).
   * @param tab The tab to save
   * @returns Promise that resolves when save is complete
   */
  saveTab(tab: Tab): Promise<void>;

  /**
   * Saves multiple tabs to storage (creates or updates).
   * Useful for batch operations and improved performance.
   * @param tabs The array of tabs to save
   * @returns Promise that resolves when all saves are complete
   */
  saveTabs(tabs: Tab[]): Promise<void>;

  /**
   * Deletes a tab from storage.
   * @param id The tab ID to delete
   * @returns Promise that resolves when deletion is complete
   */
  deleteTab(id: string): Promise<void>;

  /**
   * Retrieves all sessions for a given user.
   * @param userId The ID of the user
   * @returns Promise resolving to an array of sessions
   */
  getSessions(userId: string): Promise<Session[]>;

  /**
   * Saves a session to storage (creates or updates).
   * @param session The session to save
   * @returns Promise that resolves when save is complete
   */
  saveSession(session: Session): Promise<void>;

  // ==================== WORKSPACE HISTORY OPERATIONS ====================

  /**
   * Saves a history entry (point-in-time tab snapshot) for a workspace.
   * @param entry The history entry to save
   */
  saveHistoryEntry(entry: WorkspaceHistoryEntry): Promise<void>;

  /**
   * Gets the most recent history entry for a workspace.
   * Used for deduplication — only save if URLs changed.
   * @param workspaceId The workspace ID
   */
  getLatestHistoryEntry(workspaceId: string): Promise<WorkspaceHistoryEntry | null>;

  /**
   * Gets history entries for a workspace, newest first.
   * @param workspaceId The workspace ID
   * @param limit Max entries to return (default 100)
   */
  getHistory(workspaceId: string, limit?: number): Promise<WorkspaceHistoryEntry[]>;

  /**
   * Deletes history entries older than the given date.
   * @param olderThan Entries before this date are deleted
   * @returns The number of entries deleted
   */
  pruneHistory(olderThan: Date): Promise<number>;
}
