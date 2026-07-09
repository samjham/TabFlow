/**
 * Extension Client — sends messages to the TabFlow service worker
 * and queries extension state from the test runner.
 *
 * Uses Puppeteer's page.evaluate() to run chrome.runtime.sendMessage
 * from within an extension page, simulating what the popup/newtab UI does.
 */

import type { Page } from 'puppeteer-core';

/** Message types matching MessageHandler.ts */
export const MessageType = {
  GET_WORKSPACES: 'GET_WORKSPACES',
  CREATE_WORKSPACE: 'CREATE_WORKSPACE',
  DELETE_WORKSPACE: 'DELETE_WORKSPACE',
  GET_TABS: 'GET_TABS',
  GET_ACTIVE_WORKSPACE_TABS: 'GET_ACTIVE_WORKSPACE_TABS',
  REMOVE_TAB: 'REMOVE_TAB',
  SWITCH_WORKSPACE: 'SWITCH_WORKSPACE',
  RENAME_WORKSPACE: 'RENAME_WORKSPACE',
  CLOSE_ALL_TABS: 'CLOSE_ALL_TABS',
} as const;

/**
 * Send a message to the service worker via an extension page.
 * The page must be an extension page (newtab, popup) so it has
 * access to chrome.runtime.sendMessage.
 */
export async function sendMessage(
  page: Page,
  type: string,
  payload?: any
): Promise<any> {
  return page.evaluate(
    async ({ type, payload }) => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, payload }, (response: any) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    },
    { type, payload }
  );
}

/**
 * Get all workspaces from the service worker.
 */
export async function getWorkspaces(page: Page): Promise<any[]> {
  const response = await sendMessage(page, MessageType.GET_WORKSPACES, {
    userId: 'local-user',
  });
  if (!response?.success) {
    throw new Error(`GET_WORKSPACES failed: ${response?.error}`);
  }
  return response.data;
}

/**
 * Get the active workspace.
 */
export async function getActiveWorkspace(page: Page): Promise<any> {
  const workspaces = await getWorkspaces(page);
  return workspaces.find((ws: any) => ws.isActive);
}

/**
 * Create a new workspace.
 */
export async function createWorkspace(
  page: Page,
  name: string
): Promise<any> {
  const response = await sendMessage(page, MessageType.CREATE_WORKSPACE, {
    userId: 'local-user',
    name,
  });
  if (!response?.success) {
    throw new Error(`CREATE_WORKSPACE failed: ${response?.error}`);
  }
  return response.data;
}

/**
 * Switch to a workspace by ID.
 */
export async function switchWorkspace(
  page: Page,
  workspaceId: string
): Promise<any> {
  const response = await sendMessage(page, MessageType.SWITCH_WORKSPACE, {
    workspaceId,
  });
  if (!response?.success) {
    throw new Error(`SWITCH_WORKSPACE failed: ${response?.error}`);
  }
  return response.data;
}

/**
 * Get tabs for a specific workspace.
 */
export async function getTabs(
  page: Page,
  workspaceId: string
): Promise<any[]> {
  const response = await sendMessage(page, MessageType.GET_TABS, {
    workspaceId,
  });
  if (!response?.success) {
    throw new Error(`GET_TABS failed: ${response?.error}`);
  }
  return response.data;
}

/**
 * Close all tabs in a workspace.
 */
export async function closeAllTabs(
  page: Page,
  workspaceId: string
): Promise<any> {
  const response = await sendMessage(page, MessageType.CLOSE_ALL_TABS, {
    workspaceId,
  });
  if (!response?.success) {
    throw new Error(`CLOSE_ALL_TABS failed: ${response?.error}`);
  }
  return response.data;
}

/**
 * Query Chrome tabs from within an extension page.
 */
export async function queryChromeTabs(
  page: Page,
  queryInfo: chrome.tabs.QueryInfo = {}
): Promise<any[]> {
  return page.evaluate(async (queryInfo) => {
    return chrome.tabs.query(queryInfo);
  }, queryInfo);
}

/**
 * Get the stored tabFlowTabId from chrome.storage.local.
 */
export async function getTabFlowTabId(page: Page): Promise<number | undefined> {
  return page.evaluate(async () => {
    const result = await chrome.storage.local.get('tabFlowTabId');
    return result.tabFlowTabId;
  });
}

/**
 * Get the hidden window map from chrome.storage.local.
 */
export async function getHiddenWindowMap(
  page: Page
): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const result = await chrome.storage.local.get('hiddenWindows');
    return result.hiddenWindows || {};
  });
}
