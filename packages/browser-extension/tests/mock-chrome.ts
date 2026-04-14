/**
 * Mock Chrome APIs for testing MessageHandler without a real browser.
 *
 * Only stubs the APIs that MessageHandler actually calls.
 * Install this BEFORE importing MessageHandler.
 */

/** Fake Chrome tabs storage */
const fakeTabs: chrome.tabs.Tab[] = [];
let nextTabId = 1000;

/** Fake Chrome windows */
const fakeWindows: chrome.windows.Window[] = [
  { id: 1, focused: true, alwaysOnTop: false, incognito: false, type: 'normal' as any, state: 'normal' as any },
];

/** Fake chrome.storage.local data */
const fakeStorageLocal: Record<string, any> = {};

/** Fake chrome.storage.session data */
const fakeStorageSession: Record<string, any> = {};

export function addFakeTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  const tab: chrome.tabs.Tab = {
    id: nextTabId++,
    index: fakeTabs.length,
    pinned: false,
    highlighted: false,
    windowId: 1,
    active: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    url: 'https://example.com',
    title: 'Example',
    ...overrides,
  };
  fakeTabs.push(tab);
  return tab;
}

export function clearFakeTabs(): void {
  fakeTabs.length = 0;
}

export function getFakeTabs(): chrome.tabs.Tab[] {
  return fakeTabs;
}

/** Install the global chrome mock. Call in beforeAll/beforeEach. */
export function installChromeMock(): void {
  const chromeMock = {
    tabs: {
      query: async (queryInfo: any) => {
        let result = [...fakeTabs];
        if (queryInfo.windowId !== undefined) {
          result = result.filter((t) => t.windowId === queryInfo.windowId);
        }
        if (queryInfo.pinned !== undefined) {
          result = result.filter((t) => t.pinned === queryInfo.pinned);
        }
        return result;
      },
      get: async (tabId: number) => {
        const tab = fakeTabs.find((t) => t.id === tabId);
        if (!tab) throw new Error(`Tab ${tabId} not found`);
        return tab;
      },
      create: async (props: any) => {
        const tab = addFakeTab(props);
        return tab;
      },
      update: async (tabId: number, props: any) => {
        const tab = fakeTabs.find((t) => t.id === tabId);
        if (tab) Object.assign(tab, props);
        return tab;
      },
      move: async (tabIds: number | number[], props: any) => {
        // no-op for testing
        return [];
      },
      remove: async (tabIds: number | number[]) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const id of ids) {
          const idx = fakeTabs.findIndex((t) => t.id === id);
          if (idx !== -1) fakeTabs.splice(idx, 1);
        }
      },
    },
    windows: {
      getAll: async () => [...fakeWindows],
      get: async (id: number) => {
        const win = fakeWindows.find((w) => w.id === id);
        if (!win) throw new Error(`Window ${id} not found`);
        return win;
      },
      getLastFocused: async () => fakeWindows[0],
      create: async (props: any) => {
        const win = { id: 100 + fakeWindows.length, ...props };
        fakeWindows.push(win);
        return win;
      },
      remove: async (id: number) => {
        const idx = fakeWindows.findIndex((w) => w.id === id);
        if (idx !== -1) fakeWindows.splice(idx, 1);
      },
      update: async () => {},
    },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          if (typeof keys === 'string') keys = [keys];
          const result: Record<string, any> = {};
          for (const key of keys) {
            if (key in fakeStorageLocal) result[key] = fakeStorageLocal[key];
          }
          return result;
        },
        set: async (items: Record<string, any>) => {
          Object.assign(fakeStorageLocal, items);
        },
        remove: async (keys: string | string[]) => {
          if (typeof keys === 'string') keys = [keys];
          for (const key of keys) delete fakeStorageLocal[key];
        },
      },
      session: {
        set: async (items: Record<string, any>) => {
          Object.assign(fakeStorageSession, items);
        },
        get: async (keys: string | string[]) => {
          if (typeof keys === 'string') keys = [keys];
          const result: Record<string, any> = {};
          for (const key of keys) {
            if (key in fakeStorageSession) result[key] = fakeStorageSession[key];
          }
          return result;
        },
      },
    },
    runtime: {
      id: 'test-extension-id',
      sendMessage: async () => {},
      lastError: null,
    },
    alarms: {
      create: () => {},
      clear: async () => {},
    },
    sidePanel: {
      setPanelBehavior: () => {},
    },
  };

  (globalThis as any).chrome = chromeMock;
}

/** Reset all fake state. Call in beforeEach. */
export function resetChromeMock(): void {
  fakeTabs.length = 0;
  fakeWindows.length = 0;
  fakeWindows.push({
    id: 1, focused: true, alwaysOnTop: false, incognito: false,
    type: 'normal' as any, state: 'normal' as any,
  });
  nextTabId = 1000;
  for (const key of Object.keys(fakeStorageLocal)) delete fakeStorageLocal[key];
  for (const key of Object.keys(fakeStorageSession)) delete fakeStorageSession[key];
}
