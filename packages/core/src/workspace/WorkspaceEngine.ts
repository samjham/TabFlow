/**
 * WorkspaceEngine - Core business logic for managing workspaces, tabs, and sessions.
 * Provides a high-level API for workspace operations with automatic persistence.
 */

import { Workspace, Tab, Session, WorkspaceSnapshot, SyncEvent } from '../models/types';
import { StorageAdapter } from '../storage/StorageAdapter';

/**
 * Main engine for workspace and tab management operations.
 * Handles creating, modifying, and deleting workspaces and tabs,
 * as well as session persistence and restoration.
 */
export class WorkspaceEngine {
  private storage: StorageAdapter;

  /**
   * Creates a new WorkspaceEngine instance.
   * @param storage The storage adapter to use for persistence
   */
  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  /**
   * Creates a new workspace for a user.
   * @param userId The ID of the user creating the workspace
   * @param name The name of the new workspace
   * @param color Optional color identifier for the workspace
   * @returns Promise resolving to the created workspace
   */
  async createWorkspace(
    userId: string,
    name: string,
    color?: string
  ): Promise<Workspace> {
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      userId,
      name,
      color,
      sortOrder: Date.now(),
      isActive: false,
      updatedAt: new Date(),
      version: 1,
    };

    await this.storage.saveWorkspace(workspace);
    return workspace;
  }

  /**
   * Renames an existing workspace.
   * @param id The workspace ID
   * @param name The new name for the workspace
   * @returns Promise that resolves when the rename is complete
   * @throws Error if workspace is not found
   */
  async renameWorkspace(id: string, name: string): Promise<void> {
    const workspace = await this.storage.getWorkspace(id);
    if (!workspace) {
      throw new Error(`Workspace with ID ${id} not found`);
    }

    workspace.name = name;
    workspace.updatedAt = new Date();
    workspace.version++;

    await this.storage.saveWorkspace(workspace);
  }

  /**
   * Deletes a workspace and all its associated tabs.
   * @param id The workspace ID to delete
   * @returns Promise that resolves when deletion is complete
   */
  async deleteWorkspace(id: string): Promise<void> {
    const tabs = await this.storage.getTabs(id);

    // Delete all tabs in this workspace
    for (const tab of tabs) {
      await this.storage.deleteTab(tab.id);
    }

    // Delete the workspace itself
    await this.storage.deleteWorkspace(id);
  }

  /**
   * Gets all workspaces for a user, sorted by sort order.
   * @param userId The ID of the user
   * @returns Promise resolving to an array of workspaces sorted by sortOrder
   */
  async getWorkspaces(userId: string): Promise<Workspace[]> {
    const workspaces = await this.storage.getWorkspaces(userId);
    return workspaces.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Sets a workspace as active for a user, deactivating all others.
   * @param userId The ID of the user
   * @param workspaceId The ID of the workspace to activate
   * @returns Promise that resolves when the operation is complete
   * @throws Error if workspace is not found
   */
  async setActiveWorkspace(userId: string, workspaceId: string): Promise<void> {
    const workspaces = await this.storage.getWorkspaces(userId);
    const targetWorkspace = workspaces.find((w) => w.id === workspaceId);

    if (!targetWorkspace) {
      throw new Error(`Workspace with ID ${workspaceId} not found`);
    }

    // Deactivate all other workspaces
    for (const workspace of workspaces) {
      if (workspace.id !== workspaceId && workspace.isActive) {
        workspace.isActive = false;
        workspace.updatedAt = new Date();
        workspace.version++;
        await this.storage.saveWorkspace(workspace);
      }
    }

    // Activate the target workspace
    targetWorkspace.isActive = true;
    targetWorkspace.updatedAt = new Date();
    targetWorkspace.version++;
    await this.storage.saveWorkspace(targetWorkspace);
  }

  /**
   * Adds a new tab to a workspace.
   * @param workspaceId The ID of the workspace
   * @param url The URL of the tab
   * @param title The title of the tab
   * @param faviconUrl Optional favicon URL
   * @returns Promise resolving to the created tab
   * @throws Error if workspace is not found
   */
  async addTab(
    workspaceId: string,
    url: string,
    title: string,
    faviconUrl?: string
  ): Promise<Tab> {
    const workspace = await this.storage.getWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace with ID ${workspaceId} not found`);
    }

    const tab: Tab = {
      id: crypto.randomUUID(),
      workspaceId,
      url,
      title,
      faviconUrl,
      sortOrder: Date.now(),
      isPinned: false,
      lastAccessed: new Date(),
      updatedAt: new Date(),
    };

    await this.storage.saveTab(tab);
    return tab;
  }

  /**
   * Removes a tab from a workspace.
   * @param tabId The ID of the tab to remove
   * @returns Promise that resolves when deletion is complete
   */
  async removeTab(tabId: string): Promise<void> {
    await this.storage.deleteTab(tabId);
  }

  /**
   * Moves a tab from one workspace to another.
   * @param tabId The ID of the tab to move
   * @param targetWorkspaceId The ID of the destination workspace
   * @param sortOrder Optional sort order in the new workspace
   * @returns Promise that resolves when the move is complete
   * @throws Error if tab or target workspace is not found
   */
  async moveTab(
    tabId: string,
    targetWorkspaceId: string,
    sortOrder?: number
  ): Promise<void> {
    // Verify target workspace exists
    const targetWorkspace = await this.storage.getWorkspace(
      targetWorkspaceId
    );
    if (!targetWorkspace) {
      throw new Error(
        `Target workspace with ID ${targetWorkspaceId} not found`
      );
    }

    const tabs = await this.storage.getTabs(targetWorkspaceId);
    const tab = tabs.find((t) => t.id === tabId);

    if (!tab) {
      throw new Error(`Tab with ID ${tabId} not found`);
    }

    tab.workspaceId = targetWorkspaceId;
    tab.sortOrder = sortOrder ?? Date.now();
    tab.updatedAt = new Date();

    await this.storage.saveTab(tab);
  }

  /**
   * Creates a session snapshot of all workspaces and their tabs for a user.
   * @param userId The ID of the user
   * @param name The name for this session
   * @returns Promise resolving to the created session
   */
  async saveSession(userId: string, name: string): Promise<Session> {
    const workspaces = await this.storage.getWorkspaces(userId);
    const snapshot: WorkspaceSnapshot[] = [];

    for (const workspace of workspaces) {
      const tabs = await this.storage.getTabs(workspace.id);
      snapshot.push({ workspace, tabs });
    }

    const session: Session = {
      id: crypto.randomUUID(),
      userId,
      name,
      snapshot,
      createdAt: new Date(),
    };

    await this.storage.saveSession(session);
    return session;
  }

  /**
   * Restores a previously saved session, recreating all workspaces and tabs.
   * @param sessionId The ID of the session to restore
   * @returns Promise that resolves when restoration is complete
   * @throws Error if session data is invalid or incomplete
   */
  async restoreSession(sessionId: string): Promise<void> {
    // TODO: Implement session retrieval - requires updating StorageAdapter
    // to support getSession(sessionId) method
    throw new Error('Session restoration requires session retrieval from storage');
  }
}
