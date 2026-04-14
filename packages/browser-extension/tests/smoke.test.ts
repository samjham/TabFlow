/**
 * TabFlow Smoke Tests
 *
 * End-to-end tests that verify core TabFlow functionality by loading
 * the extension in a real Chrome instance. These tests catch integration
 * issues that unit tests miss — service worker lifecycle, tab event
 * ordering, IndexedDB persistence, etc.
 *
 * PREREQUISITES:
 * 1. Build the extension first: npm run build -w packages/chrome-extension
 * 2. Close all Chrome windows (Puppeteer needs its own instance)
 * 3. Run: npm run test:smoke -w packages/chrome-extension
 *
 * The tests run sequentially and share one browser instance.
 * State accumulates across tests (workspace created in test 3
 * is used in test 5).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Browser, Page } from 'puppeteer-core';
import {
  launchBrowser,
  closeBrowser,
  getNewTabUrl,
  getBrowser,
  getExtensionId,
} from './utils/browser';
import {
  getWorkspaces,
  getActiveWorkspace,
  createWorkspace,
  switchWorkspace,
  getTabs,
  closeAllTabs,
  queryChromeTabs,
  getTabFlowTabId,
  getHiddenWindowMap,
} from './utils/extension-client';

/** Helper: wait for a condition with timeout */
async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs = 10_000,
  intervalMs = 500
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/** The extension page used to send messages to the service worker */
let extPage: Page;
let createdWorkspaceId: string;

describe('TabFlow Smoke Tests', () => {
  beforeAll(async () => {
    // Launch Chrome with the extension
    await launchBrowser();

    // Open an extension page to use for sending messages.
    // The newtab override page has access to chrome.runtime.sendMessage.
    const browser = getBrowser();
    extPage = await browser.newPage();
    await extPage.goto(getNewTabUrl(), { waitUntil: 'networkidle0' });

    // Wait for the service worker to finish startup
    await new Promise((r) => setTimeout(r, 3000));
  }, 30_000);

  afterAll(async () => {
    await closeBrowser();
  });

  // ─── Test 1: Extension loads and TabFlow tab is pinned ─────────────

  it('should have a pinned TabFlow tab at position 0', async () => {
    // The extension should have found/created and pinned the TabFlow tab
    const tabFlowTabId = await getTabFlowTabId(extPage);
    expect(tabFlowTabId).toBeDefined();

    // Verify it's actually pinned and at index 0
    const tabs = await queryChromeTabs(extPage, {});
    const tabFlowTab = tabs.find((t: any) => t.id === tabFlowTabId);

    expect(tabFlowTab).toBeDefined();
    expect(tabFlowTab.pinned).toBe(true);
    expect(tabFlowTab.index).toBe(0);
  });

  // ─── Test 2: Default workspace exists ──────────────────────────────

  it('should have at least one workspace on fresh load', async () => {
    const workspaces = await getWorkspaces(extPage);

    expect(workspaces.length).toBeGreaterThanOrEqual(1);

    // Exactly one should be active
    const activeWorkspaces = workspaces.filter((ws: any) => ws.isActive);
    expect(activeWorkspaces.length).toBe(1);
  });

  // ─── Test 3: Creating a new workspace ──────────────────────────────

  it('should create a new workspace', async () => {
    const workspacesBefore = await getWorkspaces(extPage);

    const result = await createWorkspace(extPage, 'Smoke Test Workspace');
    expect(result).toBeDefined();
    createdWorkspaceId = result.id;

    const workspacesAfter = await getWorkspaces(extPage);
    expect(workspacesAfter.length).toBe(workspacesBefore.length + 1);

    const newWs = workspacesAfter.find((ws: any) => ws.id === createdWorkspaceId);
    expect(newWs).toBeDefined();
    expect(newWs.name).toBe('Smoke Test Workspace');
  });

  // ─── Test 4: Tab snapshot captures open tabs ───────────────────────

  it('should capture open tabs in the active workspace via snapshot', async () => {
    const activeWs = await getActiveWorkspace(extPage);
    expect(activeWs).toBeDefined();

    // Open a real URL in the browser (will be in the main window)
    const browser = getBrowser();
    const testPage = await browser.newPage();
    await testPage.goto('https://example.com', { waitUntil: 'networkidle0' });

    // Wait for the debounced snapshot to fire (500ms debounce + margin)
    await new Promise((r) => setTimeout(r, 2000));

    // Check that the tab was captured in the active workspace
    const tabs = await getTabs(extPage, activeWs.id);
    const exampleTab = tabs.find((t: any) => t.url?.includes('example.com'));
    expect(exampleTab).toBeDefined();

    // Clean up the test tab
    await testPage.close();
    await new Promise((r) => setTimeout(r, 1000));
  });

  // ─── Test 5: Workspace switch saves and restores tabs ──────────────

  it('should save outgoing tabs and restore incoming tabs on workspace switch', async () => {
    // We should currently be on the default workspace with some tabs
    const activeWsBefore = await getActiveWorkspace(extPage);
    expect(activeWsBefore).toBeDefined();

    // Open a test tab so the outgoing workspace has something
    const browser = getBrowser();
    const outgoingPage = await browser.newPage();
    await outgoingPage.goto('https://example.com/outgoing', {
      waitUntil: 'networkidle0',
    });
    await new Promise((r) => setTimeout(r, 1500));

    // Record outgoing workspace tab count
    const outgoingTabsBefore = await getTabs(extPage, activeWsBefore.id);

    // Switch to the smoke test workspace we created in test 3
    await switchWorkspace(extPage, createdWorkspaceId);
    await new Promise((r) => setTimeout(r, 2000));

    // The active workspace should now be the smoke test workspace
    const activeWsAfter = await getActiveWorkspace(extPage);
    expect(activeWsAfter.id).toBe(createdWorkspaceId);

    // The outgoing workspace's tabs should be saved
    const outgoingTabsAfter = await getTabs(extPage, activeWsBefore.id);
    expect(outgoingTabsAfter.length).toBeGreaterThan(0);

    // Switch back
    await switchWorkspace(extPage, activeWsBefore.id);
    await new Promise((r) => setTimeout(r, 2000));

    // Verify we're back
    const activeWsFinal = await getActiveWorkspace(extPage);
    expect(activeWsFinal.id).toBe(activeWsBefore.id);
  });

  // ─── Test 6: Close All Tabs clears workspace ──────────────────────

  it('should close all tabs in a workspace', async () => {
    // Make sure the smoke test workspace has some tabs first
    await switchWorkspace(extPage, createdWorkspaceId);
    await new Promise((r) => setTimeout(r, 2000));

    // Open a tab in this workspace
    const browser = getBrowser();
    const testPage = await browser.newPage();
    await testPage.goto('https://example.com/to-close', {
      waitUntil: 'networkidle0',
    });
    await new Promise((r) => setTimeout(r, 1500));

    // Close all tabs in this workspace
    const result = await closeAllTabs(extPage, createdWorkspaceId);
    expect(result).toBeDefined();

    // Wait for the close to take effect
    await new Promise((r) => setTimeout(r, 1000));

    // Verify no tabs remain in storage for this workspace
    const remainingTabs = await getTabs(extPage, createdWorkspaceId);
    expect(remainingTabs.length).toBe(0);
  });

  // ─── Test 7: Database integrity — exactly one active workspace ─────

  it('should always have exactly one active workspace', async () => {
    const workspaces = await getWorkspaces(extPage);
    const activeWorkspaces = workspaces.filter((ws: any) => ws.isActive);

    expect(activeWorkspaces.length).toBe(1);

    // Every tab should belong to a valid workspace
    for (const ws of workspaces) {
      const tabs = await getTabs(extPage, ws.id);
      for (const tab of tabs) {
        expect(tab.workspaceId).toBe(ws.id);
      }
    }
  });

  // ─── Test 8: Hidden window map is clean ────────────────────────────

  it('should have a clean hidden window map (no stale entries)', async () => {
    const map = await getHiddenWindowMap(extPage);

    // Every entry in the map should point to a window that actually exists
    for (const [workspaceId, windowId] of Object.entries(map)) {
      const windowExists = await extPage.evaluate(async (wid: number) => {
        try {
          await chrome.windows.get(wid);
          return true;
        } catch {
          return false;
        }
      }, windowId);

      expect(
        windowExists,
        `Stale hidden window entry: workspace ${workspaceId} → window ${windowId}`
      ).toBe(true);
    }
  });

  // ─── Test 9: TabFlow tab survives and gets re-pinned ───────────────

  it('should keep TabFlow tab pinned after tab operations', async () => {
    // After all the workspace switches and tab operations above,
    // the TabFlow tab should still be pinned at position 0
    const tabFlowTabId = await getTabFlowTabId(extPage);
    expect(tabFlowTabId).toBeDefined();

    const tabs = await queryChromeTabs(extPage, {});
    const tabFlowTab = tabs.find((t: any) => t.id === tabFlowTabId);

    expect(tabFlowTab).toBeDefined();
    expect(tabFlowTab.pinned).toBe(true);
    expect(tabFlowTab.index).toBe(0);
  });
});
