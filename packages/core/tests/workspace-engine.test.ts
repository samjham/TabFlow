/**
 * WorkspaceEngine Unit Tests
 *
 * Tests the core business logic for workspace and tab management.
 * Uses an in-memory MockStorage — no Chrome APIs, no IndexedDB.
 *
 * These tests verify the invariants that TabFlow relies on:
 * - Exactly one active workspace at a time
 * - Workspace CRUD operations
 * - Tab lifecycle and workspace assignment
 * - Cascade deletes (workspace → tabs)
 * - Session snapshots
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceEngine } from '../src/workspace/WorkspaceEngine';
import { MockStorage } from './mock-storage';

const USER_ID = 'test-user';

let storage: MockStorage;
let engine: WorkspaceEngine;

beforeEach(() => {
  storage = new MockStorage();
  engine = new WorkspaceEngine(storage);
});

// ─── Workspace CRUD ──────────────────────────────────────────────────

describe('createWorkspace', () => {
  it('should create a workspace with correct properties', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'My Workspace', '#ff0000');

    expect(ws.id).toBeDefined();
    expect(ws.userId).toBe(USER_ID);
    expect(ws.name).toBe('My Workspace');
    expect(ws.color).toBe('#ff0000');
    expect(ws.isActive).toBe(false);
    expect(ws.version).toBe(1);
    expect(ws.sortOrder).toBeGreaterThan(0);
  });

  it('should persist the workspace to storage', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'Test');

    const stored = await storage.getWorkspace(ws.id);
    expect(stored).not.toBeNull();
    expect(stored!.name).toBe('Test');
  });

  it('should create multiple workspaces independently', async () => {
    await engine.createWorkspace(USER_ID, 'WS1');
    await engine.createWorkspace(USER_ID, 'WS2');
    await engine.createWorkspace(USER_ID, 'WS3');

    const all = await engine.getWorkspaces(USER_ID);
    expect(all.length).toBe(3);
  });

  it('should assign unique IDs to each workspace', async () => {
    const ws1 = await engine.createWorkspace(USER_ID, 'WS1');
    const ws2 = await engine.createWorkspace(USER_ID, 'WS2');

    expect(ws1.id).not.toBe(ws2.id);
  });
});

describe('getWorkspaces', () => {
  it('should return empty array for new user', async () => {
    const all = await engine.getWorkspaces(USER_ID);
    expect(all).toEqual([]);
  });

  it('should return workspaces sorted by sortOrder', async () => {
    // Create workspaces with small delays so sortOrder (Date.now()) differs
    const ws1 = await engine.createWorkspace(USER_ID, 'First');
    // Manually set sort orders to control test
    ws1.sortOrder = 1;
    await storage.saveWorkspace(ws1);

    const ws2 = await engine.createWorkspace(USER_ID, 'Second');
    ws2.sortOrder = 3;
    await storage.saveWorkspace(ws2);

    const ws3 = await engine.createWorkspace(USER_ID, 'Third');
    ws3.sortOrder = 2;
    await storage.saveWorkspace(ws3);

    const all = await engine.getWorkspaces(USER_ID);
    expect(all.map((w) => w.name)).toEqual(['First', 'Third', 'Second']);
  });

  it('should only return workspaces for the specified user', async () => {
    await engine.createWorkspace('user-a', 'A workspace');
    await engine.createWorkspace('user-b', 'B workspace');

    const userA = await engine.getWorkspaces('user-a');
    expect(userA.length).toBe(1);
    expect(userA[0].name).toBe('A workspace');
  });
});

describe('renameWorkspace', () => {
  it('should update the workspace name', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'Old Name');
    await engine.renameWorkspace(ws.id, 'New Name');

    const updated = await storage.getWorkspace(ws.id);
    expect(updated!.name).toBe('New Name');
  });

  it('should bump the version number', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'Test');
    expect(ws.version).toBe(1);

    await engine.renameWorkspace(ws.id, 'Renamed');
    const updated = await storage.getWorkspace(ws.id);
    expect(updated!.version).toBe(2);
  });

  it('should update the updatedAt timestamp', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'Test');
    const originalDate = ws.updatedAt;

    // Small delay to ensure timestamp changes
    await new Promise((r) => setTimeout(r, 10));
    await engine.renameWorkspace(ws.id, 'Renamed');

    const updated = await storage.getWorkspace(ws.id);
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(originalDate.getTime());
  });

  it('should throw for non-existent workspace', async () => {
    await expect(
      engine.renameWorkspace('nonexistent-id', 'Name')
    ).rejects.toThrow('not found');
  });
});

describe('deleteWorkspace', () => {
  it('should remove the workspace from storage', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'To Delete');
    await engine.deleteWorkspace(ws.id);

    const stored = await storage.getWorkspace(ws.id);
    expect(stored).toBeNull();
  });

  it('should cascade delete all tabs in the workspace', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'WS');
    await engine.addTab(ws.id, 'https://a.com', 'Tab A');
    await engine.addTab(ws.id, 'https://b.com', 'Tab B');
    await engine.addTab(ws.id, 'https://c.com', 'Tab C');

    // Verify tabs exist
    expect(storage.tabs.size).toBe(3);

    await engine.deleteWorkspace(ws.id);

    // All tabs should be gone
    expect(storage.tabs.size).toBe(0);
  });

  it('should not affect tabs in other workspaces', async () => {
    const ws1 = await engine.createWorkspace(USER_ID, 'Keep');
    const ws2 = await engine.createWorkspace(USER_ID, 'Delete');
    await engine.addTab(ws1.id, 'https://keep.com', 'Keep Tab');
    await engine.addTab(ws2.id, 'https://delete.com', 'Delete Tab');

    await engine.deleteWorkspace(ws2.id);

    expect(storage.tabs.size).toBe(1);
    const remaining = [...storage.tabs.values()][0];
    expect(remaining.url).toBe('https://keep.com');
  });
});

// ─── Active workspace invariant ──────────────────────────────────────

describe('setActiveWorkspace', () => {
  it('should activate the target workspace', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'Test');
    await engine.setActiveWorkspace(USER_ID, ws.id);

    const updated = await storage.getWorkspace(ws.id);
    expect(updated!.isActive).toBe(true);
  });

  it('should deactivate all other workspaces (exactly-one-active invariant)', async () => {
    const ws1 = await engine.createWorkspace(USER_ID, 'WS1');
    const ws2 = await engine.createWorkspace(USER_ID, 'WS2');
    const ws3 = await engine.createWorkspace(USER_ID, 'WS3');

    // Activate WS1
    await engine.setActiveWorkspace(USER_ID, ws1.id);
    let all = await engine.getWorkspaces(USER_ID);
    expect(all.filter((w) => w.isActive).length).toBe(1);
    expect(all.find((w) => w.isActive)!.id).toBe(ws1.id);

    // Switch to WS2
    await engine.setActiveWorkspace(USER_ID, ws2.id);
    all = await engine.getWorkspaces(USER_ID);
    expect(all.filter((w) => w.isActive).length).toBe(1);
    expect(all.find((w) => w.isActive)!.id).toBe(ws2.id);

    // Switch to WS3
    await engine.setActiveWorkspace(USER_ID, ws3.id);
    all = await engine.getWorkspaces(USER_ID);
    expect(all.filter((w) => w.isActive).length).toBe(1);
    expect(all.find((w) => w.isActive)!.id).toBe(ws3.id);
  });

  it('should bump version on both activated and deactivated workspaces', async () => {
    const ws1 = await engine.createWorkspace(USER_ID, 'WS1');
    const ws2 = await engine.createWorkspace(USER_ID, 'WS2');

    await engine.setActiveWorkspace(USER_ID, ws1.id);
    // ws1 version: 1 (create) → 2 (activate)
    expect((await storage.getWorkspace(ws1.id))!.version).toBe(2);

    await engine.setActiveWorkspace(USER_ID, ws2.id);
    // ws1: 2 → 3 (deactivate), ws2: 1 → 2 (activate)
    expect((await storage.getWorkspace(ws1.id))!.version).toBe(3);
    expect((await storage.getWorkspace(ws2.id))!.version).toBe(2);
  });

  it('should throw for non-existent workspace', async () => {
    await expect(
      engine.setActiveWorkspace(USER_ID, 'nonexistent-id')
    ).rejects.toThrow('not found');
  });

  it('should handle activating an already-active workspace', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'Test');
    await engine.setActiveWorkspace(USER_ID, ws.id);
    await engine.setActiveWorkspace(USER_ID, ws.id); // again

    const all = await engine.getWorkspaces(USER_ID);
    expect(all.filter((w) => w.isActive).length).toBe(1);
  });
});

// ─── Tab CRUD ────────────────────────────────────────────────────────

describe('addTab', () => {
  it('should create a tab with correct properties', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'WS');
    const tab = await engine.addTab(ws.id, 'https://example.com', 'Example', 'https://example.com/favicon.ico');

    expect(tab.id).toBeDefined();
    expect(tab.workspaceId).toBe(ws.id);
    expect(tab.url).toBe('https://example.com');
    expect(tab.title).toBe('Example');
    expect(tab.faviconUrl).toBe('https://example.com/favicon.ico');
    expect(tab.isPinned).toBe(false);
  });

  it('should persist the tab to storage', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'WS');
    const tab = await engine.addTab(ws.id, 'https://example.com', 'Example');

    const stored = [...storage.tabs.values()].find((t) => t.id === tab.id);
    expect(stored).toBeDefined();
    expect(stored!.url).toBe('https://example.com');
  });

  it('should throw when adding to non-existent workspace', async () => {
    await expect(
      engine.addTab('nonexistent-id', 'https://example.com', 'Test')
    ).rejects.toThrow('not found');
  });

  it('should assign unique IDs to each tab', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'WS');
    const tab1 = await engine.addTab(ws.id, 'https://a.com', 'A');
    const tab2 = await engine.addTab(ws.id, 'https://b.com', 'B');

    expect(tab1.id).not.toBe(tab2.id);
  });
});

describe('removeTab', () => {
  it('should delete the tab from storage', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'WS');
    const tab = await engine.addTab(ws.id, 'https://example.com', 'Example');

    await engine.removeTab(tab.id);
    expect(storage.tabs.has(tab.id)).toBe(false);
  });

  it('should not affect other tabs', async () => {
    const ws = await engine.createWorkspace(USER_ID, 'WS');
    const tab1 = await engine.addTab(ws.id, 'https://a.com', 'A');
    const tab2 = await engine.addTab(ws.id, 'https://b.com', 'B');

    await engine.removeTab(tab1.id);
    expect(storage.tabs.size).toBe(1);
    expect(storage.tabs.has(tab2.id)).toBe(true);
  });
});

// ─── Session snapshots ───────────────────────────────────────────────

describe('saveSession', () => {
  it('should create a snapshot of all workspaces and their tabs', async () => {
    const ws1 = await engine.createWorkspace(USER_ID, 'WS1');
    const ws2 = await engine.createWorkspace(USER_ID, 'WS2');
    await engine.addTab(ws1.id, 'https://a.com', 'A');
    await engine.addTab(ws1.id, 'https://b.com', 'B');
    await engine.addTab(ws2.id, 'https://c.com', 'C');

    const session = await engine.saveSession(USER_ID, 'Test Session');

    expect(session.id).toBeDefined();
    expect(session.name).toBe('Test Session');
    expect(session.userId).toBe(USER_ID);
    expect(session.snapshot.length).toBe(2);

    // Find WS1 snapshot
    const ws1Snap = session.snapshot.find((s) => s.workspace.id === ws1.id);
    expect(ws1Snap).toBeDefined();
    expect(ws1Snap!.tabs.length).toBe(2);

    // Find WS2 snapshot
    const ws2Snap = session.snapshot.find((s) => s.workspace.id === ws2.id);
    expect(ws2Snap).toBeDefined();
    expect(ws2Snap!.tabs.length).toBe(1);
  });

  it('should persist the session to storage', async () => {
    await engine.createWorkspace(USER_ID, 'WS');
    const session = await engine.saveSession(USER_ID, 'Saved');

    expect(storage.sessions.size).toBe(1);
    const stored = storage.sessions.get(session.id);
    expect(stored).toBeDefined();
    expect(stored!.name).toBe('Saved');
  });
});

// ─── Integration: full workflow ──────────────────────────────────────

describe('full workflow', () => {
  it('should handle a realistic workspace lifecycle', async () => {
    // 1. Create workspaces
    const guns = await engine.createWorkspace(USER_ID, 'Guns');
    const youtube = await engine.createWorkspace(USER_ID, 'YouTube');
    const work = await engine.createWorkspace(USER_ID, 'Work');

    // 2. Activate YouTube
    await engine.setActiveWorkspace(USER_ID, youtube.id);

    // 3. Add tabs to each
    await engine.addTab(guns.id, 'https://guns.com', 'Guns Site');
    await engine.addTab(youtube.id, 'https://youtube.com/watch?v=123', 'Video 1');
    await engine.addTab(youtube.id, 'https://youtube.com/watch?v=456', 'Video 2');
    await engine.addTab(work.id, 'https://mail.google.com', 'Gmail');

    // 4. Verify state
    let all = await engine.getWorkspaces(USER_ID);
    expect(all.length).toBe(3);
    expect(all.filter((w) => w.isActive).length).toBe(1);
    expect(all.find((w) => w.isActive)!.name).toBe('YouTube');

    const youtubeTabs = await storage.getTabs(youtube.id);
    expect(youtubeTabs.length).toBe(2);

    // 5. Switch to Work
    await engine.setActiveWorkspace(USER_ID, work.id);
    all = await engine.getWorkspaces(USER_ID);
    expect(all.find((w) => w.isActive)!.name).toBe('Work');

    // 6. YouTube tabs still exist (not deleted by switch)
    const youtubeTabsAfter = await storage.getTabs(youtube.id);
    expect(youtubeTabsAfter.length).toBe(2);

    // 7. Delete Guns workspace — cascade deletes its tabs
    await engine.deleteWorkspace(guns.id);
    all = await engine.getWorkspaces(USER_ID);
    expect(all.length).toBe(2);
    expect(storage.tabs.size).toBe(3); // 2 youtube + 1 work

    // 8. Save session
    const session = await engine.saveSession(USER_ID, 'Before cleanup');
    expect(session.snapshot.length).toBe(2);

    // 9. Rename workspace
    await engine.renameWorkspace(work.id, 'Office');
    const workRenamed = await storage.getWorkspace(work.id);
    expect(workRenamed!.name).toBe('Office');
  });
});
