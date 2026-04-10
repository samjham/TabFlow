/**
 * IndexedDB Storage Adapter for TabFlow Chrome Extension
 * Implements the StorageAdapter interface using Dexie.js
 * Provides persistent storage for workspaces, tabs, and sessions
 */

import Dexie, { Table } from 'dexie';
import { StorageAdapter } from '@tabflow/core';
import { Workspace, Tab, Session, WorkspaceHistoryEntry } from '@tabflow/core';

/**
 * Dexie database definition for TabFlow
 * Manages all storage tables with proper indexing and schema versioning
 */
class TabFlowDatabase extends Dexie {
  /** Workspaces table */
  workspaces!: Table<Workspace>;

  /** Tabs table */
  tabs!: Table<Tab>;

  /** Sessions table */
  sessions!: Table<Session>;

  /** Workspace history table (point-in-time tab snapshots for rewind) */
  workspaceHistory!: Table<WorkspaceHistoryEntry>;

  /** Tab thumbnails table (cached webpage screenshots keyed by URL) */
  thumbnails!: Table<{ url: string; dataUrl: string; capturedAt: number }>;

  constructor() {
    super('tabflow');
    this.version(1).stores({
      workspaces: '&id, userId, sortOrder',
      tabs: '&id, workspaceId, sortOrder',
      sessions: '&id, userId',
    });

    // v2: Add workspace history table for rewind feature.
    this.version(2).stores({
      workspaces: '&id, userId, sortOrder',
      tabs: '&id, workspaceId, sortOrder',
      sessions: '&id, userId',
      workspaceHistory: '&id, workspaceId, [workspaceId+timestamp], timestamp',
    });

    // v3: Add thumbnails table for tab preview images.
    // Keyed by URL (normalized). capturedAt enables LRU eviction.
    this.version(3).stores({
      workspaces: '&id, userId, sortOrder',
      tabs: '&id, workspaceId, sortOrder',
      sessions: '&id, userId',
      workspaceHistory: '&id, workspaceId, [workspaceId+timestamp], timestamp',
      thumbnails: '&url, capturedAt',
    });
  }
}

/**
 * IndexedDB implementation of the StorageAdapter interface
 * Provides methods for CRUD operations on workspaces, tabs, and sessions
 * All operations are fully asynchronous using Dexie's Promise-based API
 */
class IndexedDBStorageAdapter implements StorageAdapter {
  private db: TabFlowDatabase;

  /**
   * Initializes the adapter with a Dexie database instance
   * @param db The TabFlowDatabase instance to use for storage operations
   */
  constructor(db: TabFlowDatabase) {
    this.db = db;
  }

  // ==================== WORKSPACE OPERATIONS ====================

  /**
   * Retrieves all workspaces for a given user
   * Uses indexed query on userId for optimal performance
   * @param userId The ID of the user
   * @returns Promise resolving to an array of workspaces sorted by sortOrder
   */
  async getWorkspaces(userId: string): Promise<Workspace[]> {
    return this.db.workspaces
      .where('userId')
      .equals(userId)
      .sortBy('sortOrder');
  }

  /**
   * Retrieves a single workspace by ID
   * Uses the primary key index for O(1) lookup
   * @param id The workspace ID
   * @returns Promise resolving to the workspace or null if not found
   */
  async getWorkspace(id: string): Promise<Workspace | null> {
    const workspace = await this.db.workspaces.get(id);
    return workspace || null;
  }

  /**
   * Saves a workspace to storage (creates or updates)
   * Automatically handles insertion or update based on key existence
   * @param workspace The workspace to save
   * @returns Promise that resolves when save is complete
   * @throws May throw if the write operation fails
   */
  async saveWorkspace(workspace: Workspace): Promise<void> {
    await this.db.workspaces.put(workspace);
  }

  /**
   * Deletes a workspace from storage
   * Note: Consider implementing cascade delete for related tabs in application logic
   * @param id The workspace ID to delete
   * @returns Promise that resolves when deletion is complete
   */
  async deleteWorkspace(id: string): Promise<void> {
    await this.db.workspaces.delete(id);
  }

  // ==================== TAB OPERATIONS ====================

  /**
   * Retrieves all tabs in a workspace
   * Uses indexed query on workspaceId for efficient lookup
   * Results are sorted by sortOrder for consistent UI rendering
   * @param workspaceId The ID of the workspace
   * @returns Promise resolving to an array of tabs
   */
  async getTabs(workspaceId: string): Promise<Tab[]> {
    return this.db.tabs
      .where('workspaceId')
      .equals(workspaceId)
      .sortBy('sortOrder');
  }

  /**
   * Saves a single tab to storage (creates or updates)
   * Automatically handles insertion or update based on key existence
   * @param tab The tab to save
   * @returns Promise that resolves when save is complete
   * @throws May throw if the write operation fails
   */
  async saveTab(tab: Tab): Promise<void> {
    await this.db.tabs.put(tab);
  }

  /**
   * Saves multiple tabs to storage (creates or updates)
   * Performs a batch operation for improved performance
   * More efficient than calling saveTab multiple times
   * @param tabs The array of tabs to save
   * @returns Promise that resolves when all saves are complete
   * @throws May throw if any write operation fails
   */
  async saveTabs(tabs: Tab[]): Promise<void> {
    await this.db.tabs.bulkPut(tabs);
  }

  /**
   * Deletes a tab from storage
   * @param id The tab ID to delete
   * @returns Promise that resolves when deletion is complete
   */
  async deleteTab(id: string): Promise<void> {
    await this.db.tabs.delete(id);
  }

  // ==================== WORKSPACE HISTORY OPERATIONS ====================

  /**
   * Saves a history entry for a workspace.
   * Called by the snapshot system when tab URLs change.
   */
  async saveHistoryEntry(entry: WorkspaceHistoryEntry): Promise<void> {
    await this.db.workspaceHistory.put(entry);
  }

  /**
   * Gets the most recent history entry for a workspace.
   * Used for deduplication — only save if URLs changed from this entry.
   */
  async getLatestHistoryEntry(workspaceId: string): Promise<WorkspaceHistoryEntry | null> {
    const entries = await this.db.workspaceHistory
      .where('[workspaceId+timestamp]')
      .between([workspaceId, Dexie.minKey], [workspaceId, Dexie.maxKey])
      .reverse()
      .limit(1)
      .toArray();
    return entries[0] ?? null;
  }

  /**
   * Gets history entries for a workspace, newest first.
   * @param limit Max entries to return (default 100)
   */
  async getHistory(workspaceId: string, limit = 100): Promise<WorkspaceHistoryEntry[]> {
    return this.db.workspaceHistory
      .where('[workspaceId+timestamp]')
      .between([workspaceId, Dexie.minKey], [workspaceId, Dexie.maxKey])
      .reverse()
      .limit(limit)
      .toArray();
  }

  /**
   * Deletes history entries older than the given date.
   * Called periodically for 30-day retention.
   */
  async pruneHistory(olderThan: Date): Promise<number> {
    const entries = await this.db.workspaceHistory
      .where('timestamp')
      .below(olderThan)
      .toArray();
    const ids = entries.map((e) => e.id);
    await this.db.workspaceHistory.bulkDelete(ids);
    return ids.length;
  }

  // ==================== THUMBNAIL OPERATIONS ====================

  /**
   * Save a thumbnail data URL for a given page URL.
   * Overwrites any existing thumbnail for the same URL.
   */
  async saveThumbnail(url: string, dataUrl: string): Promise<void> {
    await this.db.thumbnails.put({ url, dataUrl, capturedAt: Date.now() });
  }

  /**
   * Get a thumbnail data URL for a given page URL.
   * Returns null if no thumbnail exists.
   */
  async getThumbnail(url: string): Promise<string | null> {
    const entry = await this.db.thumbnails.get(url);
    return entry?.dataUrl ?? null;
  }

  /**
   * Get thumbnails for multiple URLs in one batch.
   * Returns a map of url → dataUrl for URLs that have thumbnails.
   */
  async getThumbnails(urls: string[]): Promise<Record<string, string>> {
    const entries = await this.db.thumbnails.where('url').anyOf(urls).toArray();
    const result: Record<string, string> = {};
    for (const entry of entries) {
      result[entry.url] = entry.dataUrl;
    }
    return result;
  }

  /**
   * Prune old thumbnails, keeping only the most recent `maxCount` entries.
   * Called periodically to prevent unbounded growth.
   */
  async pruneThumbnails(maxCount: number = 500): Promise<number> {
    const total = await this.db.thumbnails.count();
    if (total <= maxCount) return 0;
    const toDelete = total - maxCount;
    // Delete oldest entries first
    const oldest = await this.db.thumbnails.orderBy('capturedAt').limit(toDelete).toArray();
    const urls = oldest.map((e) => e.url);
    await this.db.thumbnails.bulkDelete(urls);
    return urls.length;
  }

  // ==================== SESSION OPERATIONS ====================

  /**
   * Retrieves all sessions for a given user
   * Uses indexed query on userId for efficient lookup
   * @param userId The ID of the user
   * @returns Promise resolving to an array of sessions
   */
  async getSessions(userId: string): Promise<Session[]> {
    return this.db.sessions
      .where('userId')
      .equals(userId)
      .toArray();
  }

  /**
   * Saves a session to storage (creates or updates)
   * Sessions can be large (contain full workspace snapshots), so ensure adequate storage quota
   * @param session The session to save
   * @returns Promise that resolves when save is complete
   * @throws May throw if the write operation fails or storage quota is exceeded
   */
  async saveSession(session: Session): Promise<void> {
    await this.db.sessions.put(session);
  }
}

// ==================== SINGLETON EXPORTS ====================

/**
 * Singleton instance of the TabFlow database
 * Use this for direct database access when needed
 */
export const db = new TabFlowDatabase();

/**
 * Singleton instance of the IndexedDB storage adapter
 * Use this as the primary interface for storage operations throughout the extension
 * Implements the StorageAdapter interface from @tabflow/core
 */
export const storage = new IndexedDBStorageAdapter(db);

export { TabFlowDatabase, IndexedDBStorageAdapter };
