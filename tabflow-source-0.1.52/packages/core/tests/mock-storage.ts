/**
 * In-memory StorageAdapter for testing.
 * Stores everything in plain Maps — no IndexedDB, no Chrome APIs.
 */

import type { StorageAdapter } from '../src/storage/StorageAdapter';
import type { Workspace, Tab, Session, WorkspaceHistoryEntry } from '../src/models/types';

export class MockStorage implements StorageAdapter {
  workspaces = new Map<string, Workspace>();
  tabs = new Map<string, Tab>();
  sessions = new Map<string, Session>();
  historyEntries = new Map<string, WorkspaceHistoryEntry>();

  async getWorkspaces(userId: string): Promise<Workspace[]> {
    return [...this.workspaces.values()].filter((w) => w.userId === userId);
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id) ?? null;
  }

  async saveWorkspace(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, { ...workspace });
  }

  async deleteWorkspace(id: string): Promise<void> {
    this.workspaces.delete(id);
  }

  async getTabs(workspaceId: string): Promise<Tab[]> {
    return [...this.tabs.values()].filter((t) => t.workspaceId === workspaceId);
  }

  async saveTab(tab: Tab): Promise<void> {
    this.tabs.set(tab.id, { ...tab });
  }

  async saveTabs(tabs: Tab[]): Promise<void> {
    for (const tab of tabs) {
      this.tabs.set(tab.id, { ...tab });
    }
  }

  async deleteTab(id: string): Promise<void> {
    this.tabs.delete(id);
  }

  async getSessions(userId: string): Promise<Session[]> {
    return [...this.sessions.values()].filter((s) => s.userId === userId);
  }

  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }

  // ==================== WORKSPACE HISTORY ====================

  async saveHistoryEntry(entry: WorkspaceHistoryEntry): Promise<void> {
    this.historyEntries.set(entry.id, { ...entry });
  }

  async getLatestHistoryEntry(workspaceId: string): Promise<WorkspaceHistoryEntry | null> {
    const entries = [...this.historyEntries.values()]
      .filter((e) => e.workspaceId === workspaceId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return entries[0] ?? null;
  }

  async getHistory(workspaceId: string, limit = 100): Promise<WorkspaceHistoryEntry[]> {
    return [...this.historyEntries.values()]
      .filter((e) => e.workspaceId === workspaceId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async pruneHistory(olderThan: Date): Promise<number> {
    let count = 0;
    for (const [id, entry] of this.historyEntries) {
      if (new Date(entry.timestamp) < olderThan) {
        this.historyEntries.delete(id);
        count++;
      }
    }
    return count;
  }

  /** Reset all data — call in beforeEach for clean tests */
  clear(): void {
    this.workspaces.clear();
    this.tabs.clear();
    this.sessions.clear();
    this.historyEntries.clear();
  }
}
