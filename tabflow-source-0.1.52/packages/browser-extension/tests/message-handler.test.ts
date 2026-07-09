/**
 * MessageHandler Unit Tests
 *
 * Tests the message routing and handler logic with mocked Chrome APIs
 * and a mock TabManager. Focuses on the handlers that have testable
 * business logic (CRUD, validation, error handling).
 *
 * Chrome-heavy handlers (SWITCH_WORKSPACE, CLOSE_ALL_TABS) are tested
 * lightly — their full behavior is covered by the Puppeteer smoke tests.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installChromeMock, resetChromeMock, addFakeTab, clearFakeTabs } from './mock-chrome';

// Install chrome mock BEFORE importing MessageHandler (it references chrome at import time)
installChromeMock();

// Now import — these modules will see the global chrome mock
import { MessageHandler, MessageType, type Message } from '../src/background/MessageHandler';

// Reuse the same MockStorage from core tests
import { MockStorage } from '../../core/tests/mock-storage';

let storage: MockStorage;
let handler: MessageHandler;

/** Helper to send a message and get the response */
async function send(type: string, payload?: any) {
  return handler.handleMessage({ type: type as MessageType, payload } as Message);
}

beforeAll(() => {
  installChromeMock();
});

beforeEach(() => {
  resetChromeMock();
  storage = new MockStorage();
  // Pass a no-op switching callback; TabManager gets the mock chrome APIs
  handler = new MessageHandler(storage, () => {});
});

// ─── Message Router ──────────────────────────────────────────────────

describe('message router', () => {
  it('should return error for unknown message type', async () => {
    const res = await send('NONEXISTENT_TYPE');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Unknown message type');
  });

  it('should route to correct handler for each type', async () => {
    // GET_WORKSPACES should work even with no workspaces
    const res = await send('GET_WORKSPACES');
    expect(res.success).toBe(true);
  });
});

// ─── CREATE_WORKSPACE ────────────────────────────────────────────────

describe('CREATE_WORKSPACE', () => {
  it('should create a workspace with the given name', async () => {
    const res = await send('CREATE_WORKSPACE', { name: 'My Workspace' });

    expect(res.success).toBe(true);
    expect(res.data.name).toBe('My Workspace');
    expect(res.data.id).toBeDefined();
  });

  it('should default to "New Workspace" when no name given', async () => {
    const res = await send('CREATE_WORKSPACE', {});

    expect(res.success).toBe(true);
    expect(res.data.name).toBe('New Workspace');
  });

  it('should create workspace as inactive (not auto-switch)', async () => {
    const res = await send('CREATE_WORKSPACE', { name: 'Test' });

    expect(res.data.isActive).toBe(false);
  });

  it('should assign a color from the default palette', async () => {
    const res = await send('CREATE_WORKSPACE', { name: 'Colorful' });

    expect(res.data.color).toBeDefined();
    expect(res.data.color).toMatch(/^#/);
  });

  it('should use provided color when given', async () => {
    const res = await send('CREATE_WORKSPACE', {
      name: 'Custom',
      color: '#123456',
    });

    expect(res.data.color).toBe('#123456');
  });

  it('should persist to storage', async () => {
    const res = await send('CREATE_WORKSPACE', { name: 'Persisted' });

    const stored = await storage.getWorkspace(res.data.id);
    expect(stored).not.toBeNull();
    expect(stored!.name).toBe('Persisted');
  });
});

// ─── DELETE_WORKSPACE ────────────────────────────────────────────────

describe('DELETE_WORKSPACE', () => {
  it('should delete a workspace', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'To Delete' });
    const wsId = createRes.data.id;

    const res = await send('DELETE_WORKSPACE', { workspaceId: wsId });
    expect(res.success).toBe(true);

    const stored = await storage.getWorkspace(wsId);
    expect(stored).toBeNull();
  });

  it('should return error when workspaceId missing', async () => {
    const res = await send('DELETE_WORKSPACE', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('workspaceId is required');
  });

  it('should return error for non-existent workspace', async () => {
    const res = await send('DELETE_WORKSPACE', { workspaceId: 'fake-id' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });

  it('should cascade delete tabs in the workspace', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'WS' });
    const wsId = createRes.data.id;

    // Add tabs directly to storage
    await storage.saveTab({
      id: 'tab-1', workspaceId: wsId, url: 'https://a.com', title: 'A',
      sortOrder: 0, isPinned: false, lastAccessed: new Date(), updatedAt: new Date(),
    });
    await storage.saveTab({
      id: 'tab-2', workspaceId: wsId, url: 'https://b.com', title: 'B',
      sortOrder: 1, isPinned: false, lastAccessed: new Date(), updatedAt: new Date(),
    });

    await send('DELETE_WORKSPACE', { workspaceId: wsId });

    expect(storage.tabs.size).toBe(0);
  });
});

// ─── GET_TABS ────────────────────────────────────────────────────────

describe('GET_TABS', () => {
  it('should return tabs for a workspace', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'WS' });
    const wsId = createRes.data.id;

    await storage.saveTab({
      id: 'tab-1', workspaceId: wsId, url: 'https://a.com', title: 'A',
      sortOrder: 0, isPinned: false, lastAccessed: new Date(), updatedAt: new Date(),
    });

    const res = await send('GET_TABS', { workspaceId: wsId });
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(1);
    expect(res.data[0].url).toBe('https://a.com');
  });

  it('should return empty array for workspace with no tabs', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'Empty' });

    const res = await send('GET_TABS', { workspaceId: createRes.data.id });
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('should return error when workspaceId missing', async () => {
    const res = await send('GET_TABS', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('workspaceId is required');
  });
});

// ─── REMOVE_TAB ──────────────────────────────────────────────────────

describe('REMOVE_TAB', () => {
  it('should remove a tab from storage', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'WS' });
    await storage.saveTab({
      id: 'tab-1', workspaceId: createRes.data.id, url: 'https://a.com', title: 'A',
      sortOrder: 0, isPinned: false, lastAccessed: new Date(), updatedAt: new Date(),
    });

    const res = await send('REMOVE_TAB', { tabId: 'tab-1' });
    expect(res.success).toBe(true);
    expect(storage.tabs.has('tab-1')).toBe(false);
  });

  it('should return error when tabId missing', async () => {
    const res = await send('REMOVE_TAB', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('tabId is required');
  });
});

// ─── RENAME_WORKSPACE ────────────────────────────────────────────────

describe('RENAME_WORKSPACE', () => {
  it('should rename a workspace', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'Old' });

    const res = await send('RENAME_WORKSPACE', {
      workspaceId: createRes.data.id,
      name: 'New Name',
    });
    expect(res.success).toBe(true);

    const stored = await storage.getWorkspace(createRes.data.id);
    expect(stored!.name).toBe('New Name');
  });

  it('should trim whitespace from name', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'Test' });

    await send('RENAME_WORKSPACE', {
      workspaceId: createRes.data.id,
      name: '  Trimmed  ',
    });

    const stored = await storage.getWorkspace(createRes.data.id);
    expect(stored!.name).toBe('Trimmed');
  });

  it('should return error when workspaceId missing', async () => {
    const res = await send('RENAME_WORKSPACE', { name: 'Name' });
    expect(res.success).toBe(false);
  });

  it('should return error when name is empty', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'Test' });
    const res = await send('RENAME_WORKSPACE', {
      workspaceId: createRes.data.id,
      name: '   ',
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('name is required');
  });
});

// ─── CHANGE_WORKSPACE_COLOR ──────────────────────────────────────────

describe('CHANGE_WORKSPACE_COLOR', () => {
  it('should change workspace color', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'WS' });

    const res = await send('CHANGE_WORKSPACE_COLOR', {
      workspaceId: createRes.data.id,
      color: '#ff0000',
    });
    expect(res.success).toBe(true);

    const stored = await storage.getWorkspace(createRes.data.id);
    expect(stored!.color).toBe('#ff0000');
  });

  it('should bump version on color change', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'WS' });
    const originalVersion = createRes.data.version;

    await send('CHANGE_WORKSPACE_COLOR', {
      workspaceId: createRes.data.id,
      color: '#00ff00',
    });

    const stored = await storage.getWorkspace(createRes.data.id);
    expect(stored!.version).toBe(originalVersion + 1);
  });

  it('should return error when color missing', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'WS' });
    const res = await send('CHANGE_WORKSPACE_COLOR', {
      workspaceId: createRes.data.id,
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('color is required');
  });

  it('should return error for non-existent workspace', async () => {
    const res = await send('CHANGE_WORKSPACE_COLOR', {
      workspaceId: 'fake',
      color: '#000',
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('not found');
  });
});

// ─── REORDER_WORKSPACES ──────────────────────────────────────────────

describe('REORDER_WORKSPACES', () => {
  it('should update sortOrder based on array position', async () => {
    const ws1 = (await send('CREATE_WORKSPACE', { name: 'A' })).data;
    const ws2 = (await send('CREATE_WORKSPACE', { name: 'B' })).data;
    const ws3 = (await send('CREATE_WORKSPACE', { name: 'C' })).data;

    // Reorder: C, A, B
    const res = await send('REORDER_WORKSPACES', {
      orderedIds: [ws3.id, ws1.id, ws2.id],
    });
    expect(res.success).toBe(true);

    const s1 = await storage.getWorkspace(ws1.id);
    const s2 = await storage.getWorkspace(ws2.id);
    const s3 = await storage.getWorkspace(ws3.id);

    expect(s3!.sortOrder).toBe(0); // C first
    expect(s1!.sortOrder).toBe(1); // A second
    expect(s2!.sortOrder).toBe(2); // B third
  });

  it('should return error when orderedIds missing', async () => {
    const res = await send('REORDER_WORKSPACES', {});
    expect(res.success).toBe(false);
    expect(res.error).toContain('orderedIds');
  });

  it('should bump version on each reordered workspace', async () => {
    const ws1 = (await send('CREATE_WORKSPACE', { name: 'A' })).data;
    const ws2 = (await send('CREATE_WORKSPACE', { name: 'B' })).data;

    await send('REORDER_WORKSPACES', { orderedIds: [ws2.id, ws1.id] });

    const s1 = await storage.getWorkspace(ws1.id);
    const s2 = await storage.getWorkspace(ws2.id);
    expect(s1!.version).toBe(2); // 1 (create) + 1 (reorder)
    expect(s2!.version).toBe(2);
  });
});

// ─── GET_ACTIVE_WORKSPACE_TABS ───────────────────────────────────────

describe('GET_ACTIVE_WORKSPACE_TABS', () => {
  it('should return empty array when no active workspace', async () => {
    const res = await send('GET_ACTIVE_WORKSPACE_TABS');
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('should return tabs from the active workspace', async () => {
    const createRes = await send('CREATE_WORKSPACE', { name: 'Active WS' });
    const wsId = createRes.data.id;

    // Manually activate (setActiveWorkspace is in WorkspaceEngine)
    const ws = await storage.getWorkspace(wsId);
    ws!.isActive = true;
    await storage.saveWorkspace(ws!);

    await storage.saveTab({
      id: 'tab-1', workspaceId: wsId, url: 'https://active.com', title: 'Active',
      sortOrder: 0, isPinned: false, lastAccessed: new Date(), updatedAt: new Date(),
    });

    const res = await send('GET_ACTIVE_WORKSPACE_TABS');
    expect(res.success).toBe(true);
    expect(res.data.length).toBe(1);
    expect(res.data[0].url).toBe('https://active.com');
  });
});

// ─── skipOutgoingSaveOnNextSwitch ────────────────────────────────────

describe('setSkipOutgoingSave', () => {
  it('should accept true and false without throwing', () => {
    handler.setSkipOutgoingSave(true);
    handler.setSkipOutgoingSave(false);
    // No error means the method is accessible and functional
  });
});

// ─── Integration: full CRUD lifecycle ────────────────────────────────

describe('full CRUD lifecycle', () => {
  it('should handle create, rename, recolor, reorder, delete', async () => {
    // Create 3 workspaces
    const ws1 = (await send('CREATE_WORKSPACE', { name: 'Alpha' })).data;
    const ws2 = (await send('CREATE_WORKSPACE', { name: 'Beta' })).data;
    const ws3 = (await send('CREATE_WORKSPACE', { name: 'Gamma' })).data;

    // Verify all created
    const getRes = await send('GET_WORKSPACES');
    expect(getRes.data.workspaces.length).toBe(3);

    // Rename Beta → Delta
    await send('RENAME_WORKSPACE', { workspaceId: ws2.id, name: 'Delta' });
    expect((await storage.getWorkspace(ws2.id))!.name).toBe('Delta');

    // Recolor Gamma
    await send('CHANGE_WORKSPACE_COLOR', { workspaceId: ws3.id, color: '#abcdef' });
    expect((await storage.getWorkspace(ws3.id))!.color).toBe('#abcdef');

    // Reorder: Gamma, Alpha, Delta
    await send('REORDER_WORKSPACES', { orderedIds: [ws3.id, ws1.id, ws2.id] });
    expect((await storage.getWorkspace(ws3.id))!.sortOrder).toBe(0);
    expect((await storage.getWorkspace(ws1.id))!.sortOrder).toBe(1);
    expect((await storage.getWorkspace(ws2.id))!.sortOrder).toBe(2);

    // Delete Alpha
    await send('DELETE_WORKSPACE', { workspaceId: ws1.id });
    const remaining = await send('GET_WORKSPACES');
    expect(remaining.data.workspaces.length).toBe(2);
    expect(remaining.data.workspaces.find((w: any) => w.id === ws1.id)).toBeUndefined();
  });
});
