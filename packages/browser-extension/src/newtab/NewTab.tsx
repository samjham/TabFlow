/**
 * New Tab Page Component for TabFlow
 *
 * Displays a full-screen workspace manager with:
 * - Left sidebar showing workspaces and user info
 * - Main content area showing tabs in the active workspace
 * - Collapsible sidebar with smooth interactions
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWorkspaces, WorkspaceWithCount, SearchResult } from './useWorkspaces';
import type { WorkspaceHistoryEntry } from '@tabflow/core';
import * as AuthManager from '../auth/AuthManager';
import type { Tab } from '@tabflow/core';

interface NewTabProps {
  user?: { id: string; email: string } | null;
  onSignOut?: () => void;
}

const SIDEBAR_WIDTH = 220;
const COLOR_PALETTE = [
  // Row 1 — Bold primaries & secondaries
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  // Row 2 — Rich mid-tones
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  // Row 3 — Vivid accents
  '#f43f5e', '#fb923c', '#84cc16', '#14b8a6', '#0ea5e9',
  // Row 4 — Deep & muted
  '#7c3aed', '#db2777', '#b91c1c', '#047857', '#1e40af',
];

/** Format bytes into a human-readable string (KB, MB, GB) */
function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export const NewTab: React.FC<NewTabProps> = ({ user, onSignOut }) => {
  const { workspaces, activeWorkspace, tabs, loading, error, createWorkspace, deleteWorkspace, switchWorkspace, renameWorkspace, changeWorkspaceColor, changeShortName, reorderWorkspaces, removeTab, removeTabs, moveTabs, duplicateTabs, closeAllTabs, getWorkspaceHistory, restoreHistoryEntry, searchAllWorkspaces, reorderTabs, getDeletedWorkspaces, restoreDeletedWorkspaces, permanentlyDeleteWorkspaces } = useWorkspaces();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showNewWorkspaceForm, setShowNewWorkspaceForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceColor, setNewWorkspaceColor] = useState(COLOR_PALETTE[0]);
  const [draggedWorkspaceId, setDraggedWorkspaceId] = useState<string | null>(null);
  const [dragOverWorkspaceId, setDragOverWorkspaceId] = useState<string | null>(null);
  // 'above' | 'below' — which edge of the target the drop indicator should render on.
  const [dragOverPosition, setDragOverPosition] = useState<'above' | 'below'>('below');
  const [selectedTabIds, setSelectedTabIds] = useState<Set<string>>(new Set());
  const [showMovePopup, setShowMovePopup] = useState(false);
  const [moveNewWorkspaceName, setMoveNewWorkspaceName] = useState('');
  const [moveNewWorkspaceColor, setMoveNewWorkspaceColor] = useState(COLOR_PALETTE[0]);
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [showDuplicatePopup, setShowDuplicatePopup] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<WorkspaceHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoringHistory, setRestoringHistory] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(-1);
  const movePopupRef = React.useRef<HTMLDivElement>(null);
  const duplicatePopupRef = React.useRef<HTMLDivElement>(null);
  const historyPanelRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Thumbnail cache: url → dataUrl
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  // ─── Workspace stats (memory, audible indicators) ───
  interface WorkspaceStats {
    tabCount: number;
    memoryBytes: number;
    audibleCount: number;
  }
  const [workspaceStats, setWorkspaceStats] = useState<Record<string, WorkspaceStats>>({});
  const [systemMemory, setSystemMemory] = useState<{ total: number; available: number }>({ total: 0, available: 0 });
  const [chromeMemory, setChromeMemory] = useState<number>(0);

  // ─── Deleted workspaces archive (recycle bin) ───
  const [showArchivePanel, setShowArchivePanel] = useState(false);
  const [deletedWorkspaces, setDeletedWorkspaces] = useState<any[]>([]);
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<Set<string>>(new Set());
  const [archiveLoading, setArchiveLoading] = useState(false);

  // ─── Multi-device sync: "Resume Working Here" ───
  const [isActiveDevice, setIsActiveDevice] = useState(true);
  const [inactiveClaimedBy, setInactiveClaimedBy] = useState<string | null>(null);

  // ─── Passphrase mismatch safeguard ───
  // Set when the background service worker detected that the local passphrase
  // can't decrypt the cloud canary. Sync is halted until the user re-signs in
  // with the correct passphrase.
  const [passphraseMismatch, setPassphraseMismatch] = useState<string | null>(null);

  // ─── Drag-and-drop tab reordering state ───
  const [localTabs, setLocalTabs] = useState<Tab[]>([]);
  const dragRef = useRef<{
    tabId: string;
    offsetX: number;
    offsetY: number;
    cardWidth: number;
  } | null>(null);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const localTabsRef = useRef<Tab[]>([]);

  // Clear selection when switching workspaces
  useEffect(() => {
    setSelectedTabIds(new Set());
    setShowMovePopup(false);
    setShowCloseAllConfirm(false);
    setShowDeleteSelectedConfirm(false);
    setShowDuplicatePopup(false);
  }, [activeWorkspace?.id]);

  // Fetch thumbnails for current workspace tabs
  useEffect(() => {
    if (!tabs || tabs.length === 0) return;
    const urls = tabs.map((t) => t.url).filter(Boolean);
    if (urls.length === 0) return;

    const fetchThumbnails = () => {
      chrome.runtime.sendMessage(
        { type: 'GET_THUMBNAILS', payload: { urls } },
        (response) => {
          if (response?.success && response.data) {
            setThumbnails((prev) => ({ ...prev, ...response.data }));
          }
        }
      );
    };

    // Fetch immediately
    fetchThumbnails();

    // Poll for new thumbnails periodically — thumbnails are captured lazily
    // as you visit tabs, so this picks up newly captured ones.
    const pollInterval = setInterval(fetchThumbnails, 5000);
    return () => clearInterval(pollInterval);
  }, [tabs]);

  // ─── Fetch workspace stats (memory, audible) ───
  useEffect(() => {
    const fetchStats = () => {
      chrome.runtime.sendMessage(
        { type: 'GET_WORKSPACE_STATS' },
        (response) => {
          if (response?.success && response.data) {
            setWorkspaceStats(response.data.stats || {});
            setSystemMemory({
              total: response.data.totalSystemMemory || 0,
              available: response.data.availableMemory || 0,
            });
            if (response.data.chromeMemoryBytes) {
              setChromeMemory(response.data.chromeMemoryBytes);
            }
          }
        }
      );
    };
    fetchStats();
    const statsInterval = setInterval(fetchStats, 10000); // every 10s
    return () => clearInterval(statsInterval);
  }, [workspaces.length]);

  // ─── Multi-device status: check on mount + listen for changes ───
  useEffect(() => {
    // Initial check
    chrome.runtime.sendMessage({ type: 'GET_DEVICE_STATUS' }, (response) => {
      if (response?.success && response.data) {
        setIsActiveDevice(response.data.isActive);
      }
    });

    // Check initial passphrase-mismatch state (may have been set before this
    // page loaded).
    chrome.storage.session.get('passphraseMismatch').then((stored) => {
      if (stored?.passphraseMismatch?.message) {
        setPassphraseMismatch(stored.passphraseMismatch.message);
      }
    }).catch(() => {});

    // Listen for device status + passphrase-mismatch changes via storage.session
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'session') return;
      if (changes.deviceStatus) {
        const status = changes.deviceStatus.newValue;
        if (status) {
          setIsActiveDevice(status.isActive);
          setInactiveClaimedBy(status.claimedBy || null);
        }
      }
      if (changes.passphraseMismatch) {
        const mismatch = changes.passphraseMismatch.newValue;
        setPassphraseMismatch(mismatch?.message || null);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  /** Handler for "Resume Working Here" button */
  const handleResumeHere = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'CLAIM_ACTIVE_DEVICE' }, (response) => {
      if (response?.success) {
        setIsActiveDevice(true);
        setInactiveClaimedBy(null);
      }
    });
  }, []);

  // Keep localTabs in sync with tabs from the hook (source of truth),
  // but only when we're NOT mid-drag.
  useEffect(() => {
    if (!dragTabId) {
      setLocalTabs(tabs);
    }
  }, [tabs, dragTabId]);

  // Keep localTabsRef in sync so window-level handlers can read it
  useEffect(() => {
    localTabsRef.current = localTabs;
  }, [localTabs]);

  // ─── Mouse-based drag-and-drop ───
  // Uses window-level mousemove/mouseup for reliability.
  // Pointer capture on React elements breaks when React re-renders the DOM.

  /**
   * Find which grid slot the cursor is over, based on bounding rects.
   */
  const getDropIndex = useCallback((clientX: number, clientY: number): number => {
    if (!gridRef.current) return -1;
    const children = Array.from(gridRef.current.children) as HTMLElement[];
    if (children.length === 0) return -1;

    // Check if cursor is directly over a tile
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right &&
          clientY >= rect.top && clientY <= rect.bottom) {
        return i;
      }
    }

    // Check if cursor is past the last tile (to the right of it, or below all rows)
    // — allow dropping at the end
    const lastRect = children[children.length - 1].getBoundingClientRect();
    const firstRect = children[0].getBoundingClientRect();
    const gridRect = gridRef.current.getBoundingClientRect();

    // Cursor is to the right of the last tile on the same row, or below all tiles
    if (clientY >= lastRect.top && clientY <= lastRect.bottom && clientX > lastRect.right) {
      return children.length - 1;
    }
    // Cursor is below the last row but within the grid
    if (clientY > lastRect.bottom && clientX >= gridRect.left && clientX <= gridRect.right) {
      return children.length - 1;
    }

    return -1;
  }, []);

  // Window-level handlers stored in refs so they can reference latest state
  // Drag threshold: only start dragging after mouse moves > DRAG_THRESHOLD px.
  // If mouseup fires before that, treat it as a click (open the tab).
  const DRAG_THRESHOLD = 5;
  const didDragRef = useRef(false);
  const pendingDragRef = useRef<{
    tabId: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    cardWidth: number;
    cardLeft: number;
    cardTop: number;
  } | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    const pending = pendingDragRef.current;
    if (!pending) return;

    // Check if we've crossed the drag threshold to start dragging
    if (!dragRef.current) {
      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;

      // Threshold crossed — actually start the drag
      didDragRef.current = true;
      dragRef.current = {
        tabId: pending.tabId,
        offsetX: pending.offsetX,
        offsetY: pending.offsetY,
        cardWidth: pending.cardWidth,
      };
      setDragTabId(pending.tabId);
      setDragPos({ x: pending.cardLeft, y: pending.cardTop });
    }

    const state = dragRef.current;
    if (!state) return;

    setDragPos({
      x: e.clientX - state.offsetX,
      y: e.clientY - state.offsetY,
    });

    // Determine which slot the cursor is over and reorder
    const newIndex = getDropIndex(e.clientX, e.clientY);
    if (newIndex !== -1) {
      setLocalTabs((prev) => {
        const fromIndex = prev.findIndex((t) => t.id === state.tabId);
        if (fromIndex === -1 || fromIndex === newIndex) return prev;
        const updated = [...prev];
        const [moved] = updated.splice(fromIndex, 1);
        updated.splice(newIndex, 0, moved);
        return updated;
      });
    }
  }, [getDropIndex]);

  const onMouseUp = useCallback(() => {
    pendingDragRef.current = null;

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    // If no drag happened, nothing to clean up — click handler will fire
    if (!dragRef.current) return;

    // Drag completed — persist the new order
    const orderedIds = localTabsRef.current.map((t) => t.id);
    reorderTabs(orderedIds);

    // Clean up drag state
    dragRef.current = null;
    setDragTabId(null);
    setDragPos(null);
  }, [onMouseMove, reorderTabs]);

  const handleTabDragStart = useCallback((e: React.MouseEvent, tabId: string) => {
    // Only left button
    if (e.button !== 0) return;
    // Don't start drag on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('input') || target.closest('button')) return;

    e.preventDefault(); // prevent text selection

    const card = e.currentTarget as HTMLElement;
    const rect = card.getBoundingClientRect();

    didDragRef.current = false;
    pendingDragRef.current = {
      tabId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      cardWidth: rect.width,
      cardLeft: rect.left,
      cardTop: rect.top,
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [onMouseMove, onMouseUp]);

  // Safety cleanup: remove window listeners if component unmounts mid-drag
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // Update document title + favicon to reflect active workspace
  useEffect(() => {
    if (activeWorkspace) {
      // Dynamic title — visible on hover over pinned tab
      document.title = `${activeWorkspace.name} - TabFlow`;

      // Dynamic favicon — draw workspace initials on workspace color
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Background circle in workspace color
        ctx.beginPath();
        ctx.arc(32, 32, 32, 0, Math.PI * 2);
        ctx.fillStyle = activeWorkspace.color || '#6c8cff';
        ctx.fill();

        // Use custom shortName if set, otherwise auto-generate initials
        let initials: string;
        if (activeWorkspace.shortName) {
          initials = activeWorkspace.shortName.toUpperCase();
        } else {
          const name = activeWorkspace.name.trim();
          const words = name.split(/\s+/);
          if (words.length >= 2) {
            initials = (words[0][0] + words[1][0]).toUpperCase();
          } else {
            initials = name.substring(0, 2).toUpperCase();
          }
        }
        // Scale font size down for 3-char labels
        const fontSize = initials.length > 2 ? 22 : 28;

        ctx.fillStyle = '#fff';
        ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials, 32, 34);

        // Set as favicon
        const dataUrl = canvas.toDataURL('image/png');
        let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
        if (!link) {
          link = document.createElement('link');
          link.rel = 'icon';
          document.head.appendChild(link);
        }
        link.href = dataUrl;
      }
    } else {
      document.title = 'New Tab - TabFlow';
    }
  }, [activeWorkspace?.id, activeWorkspace?.name, activeWorkspace?.color, activeWorkspace?.shortName]);

  // Click-outside handler for move popup
  useEffect(() => {
    if (!showMovePopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (movePopupRef.current && !movePopupRef.current.contains(e.target as Node)) {
        setShowMovePopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMovePopup]);

  useEffect(() => {
    if (!showDuplicatePopup) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (duplicatePopupRef.current && !duplicatePopupRef.current.contains(e.target as Node)) {
        setShowDuplicatePopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDuplicatePopup]);

  const handleDeleteSelected = async () => {
    if (selectedTabIds.size === 0) return;
    try {
      await removeTabs(Array.from(selectedTabIds));
      setSelectedTabIds(new Set());
      setShowDeleteSelectedConfirm(false);
    } catch (err) {
      // Error handled by hook
    }
  };

  const handleDuplicateToWorkspace = async (targetWorkspaceId: string) => {
    if (selectedTabIds.size === 0) return;
    try {
      await duplicateTabs(Array.from(selectedTabIds), targetWorkspaceId);
      setSelectedTabIds(new Set());
      setShowDuplicatePopup(false);
    } catch (err) {
      // Error handled by hook
    }
  };

  const toggleTabSelection = (tabId: string) => {
    setSelectedTabIds((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      return next;
    });
  };

  const handleMoveToWorkspace = async (targetWorkspaceId: string) => {
    if (selectedTabIds.size === 0) return;
    try {
      await moveTabs(Array.from(selectedTabIds), targetWorkspaceId);
      setSelectedTabIds(new Set());
      setShowMovePopup(false);
    } catch (err) {
      // Error handled by hook
    }
  };

  const handleMoveToNewWorkspace = async () => {
    if (!moveNewWorkspaceName.trim() || selectedTabIds.size === 0) return;
    try {
      await createWorkspace(moveNewWorkspaceName.trim(), moveNewWorkspaceColor);
      // After creating, find the new workspace and move tabs to it
      // We need to get the updated workspace list
      const response = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'GET_WORKSPACES' },
          (res) => {
            if (res?.success) resolve(res.data);
            else reject(new Error(res?.error || 'Failed'));
          }
        );
      });
      const newWs = (response as any[]).find(
        (ws: any) => ws.name === moveNewWorkspaceName.trim()
      );
      if (newWs) {
        await moveTabs(Array.from(selectedTabIds), newWs.id);
      }
      setSelectedTabIds(new Set());
      setShowMovePopup(false);
      setMoveNewWorkspaceName('');
      setMoveNewWorkspaceColor(COLOR_PALETTE[0]);
    } catch (err) {
      // Error handled by hook
    }
  };

  const handleDragStart = (workspaceId: string) => {
    setDraggedWorkspaceId(workspaceId);
  };

  const handleDragOver = (e: React.DragEvent, workspaceId: string) => {
    e.preventDefault();
    // Stop the event from bubbling up to the container's onDragOver,
    // which would otherwise overwrite our target with '__bottom__'.
    e.stopPropagation();
    if (!draggedWorkspaceId || draggedWorkspaceId === workspaceId) return;

    // Determine above/below based on cursor position relative to the item's midpoint.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position: 'above' | 'below' =
      e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';

    setDragOverWorkspaceId(workspaceId);
    setDragOverPosition(position);
  };

  const handleDrop = async (targetWorkspaceId: string, e?: React.DragEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!draggedWorkspaceId || draggedWorkspaceId === targetWorkspaceId) {
      setDraggedWorkspaceId(null);
      setDragOverWorkspaceId(null);
      return;
    }

    const currentOrder = workspaces.map((ws) => ws.id);
    const draggedIndex = currentOrder.indexOf(draggedWorkspaceId);
    const targetIndex = currentOrder.indexOf(targetWorkspaceId);

    // Remove dragged item, then insert either above or below the target.
    currentOrder.splice(draggedIndex, 1);
    // After removing the dragged item, the target's new index may have shifted.
    const adjustedTarget = currentOrder.indexOf(targetWorkspaceId);
    const insertAt = dragOverPosition === 'above' ? adjustedTarget : adjustedTarget + 1;
    currentOrder.splice(insertAt, 0, draggedWorkspaceId);

    setDraggedWorkspaceId(null);
    setDragOverWorkspaceId(null);

    try {
      await reorderWorkspaces(currentOrder);
    } catch (err) {
      // Error handled by hook
    }
  };

  const handleDragEnd = () => {
    setDraggedWorkspaceId(null);
    setDragOverWorkspaceId(null);
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    try {
      await createWorkspace(newWorkspaceName.trim(), newWorkspaceColor);
      setNewWorkspaceName('');
      setNewWorkspaceColor(COLOR_PALETTE[0]);
      setShowNewWorkspaceForm(false);
    } catch (err) {
      // Error is handled by the hook
    }
  };

  const handleOpenTab = (tab: Tab) => {
    // Try to activate the existing Chrome tab by its ID
    const match = tab.id.match(/^chrome-(\d+)$/);
    if (match) {
      const chromeTabId = parseInt(match[1], 10);
      chrome.tabs.update(chromeTabId, { active: true }).catch(() => {
        // Tab no longer exists — fall back to creating a new one
        chrome.tabs.create({ url: tab.url, active: true });
      });
    } else {
      // No valid chrome tab ID — create a new tab
      chrome.tabs.create({ url: tab.url, active: true });
    }
  };

  const handleRemoveTab = async (tabId: string) => {
    try {
      await removeTab(tabId);
    } catch (err) {
      // Error is handled by the hook
    }
  };

  // ─── Search ──────────────────────────────────────────────────────
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    setSelectedSearchIndex(-1);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!value.trim()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    searchDebounceRef.current = setTimeout(async () => {
      const results = await searchAllWorkspaces(value.trim());
      setSearchResults(results);
      setShowSearchResults(true);
    }, 200);
  }, [searchAllWorkspaces]);

  /** Ask the background service worker to find & activate a tab by URL */
  const activateTabByUrl = useCallback(async (url: string): Promise<boolean> => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'ACTIVATE_TAB_BY_URL', payload: { url } },
        (response) => {
          resolve(response?.success && response?.data?.found === true);
        }
      );
    });
  }, []);

  const handleSearchResultClick = useCallback(async (result: SearchResult) => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    setSelectedSearchIndex(-1);

    // If the tab is in a different workspace, switch first
    if (!result.workspace.isActive) {
      await switchWorkspace(result.workspace.id);
    }

    // Ask the background worker to find and activate the tab by URL.
    // The background has full access to all tabs in the main window.
    const found = await activateTabByUrl(result.tab.url);
    if (found) return;

    // Last resort: open a new tab
    chrome.tabs.create({ url: result.tab.url, active: true });
  }, [switchWorkspace, activateTabByUrl]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSearchResults || searchResults.length === 0) {
      if (e.key === 'Escape') {
        setSearchQuery('');
        setShowSearchResults(false);
        searchInputRef.current?.blur();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSearchIndex((i) => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSearchIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && selectedSearchIndex >= 0) {
      e.preventDefault();
      handleSearchResultClick(searchResults[selectedSearchIndex]);
    } else if (e.key === 'Escape') {
      setSearchQuery('');
      setShowSearchResults(false);
      setSelectedSearchIndex(-1);
      searchInputRef.current?.blur();
    }
  }, [showSearchResults, searchResults, selectedSearchIndex, handleSearchResultClick]);

  // Click-outside for search results
  useEffect(() => {
    if (!showSearchResults) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSearchResults]);

  // Keyboard shortcut: Ctrl+K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ─── History / Rewind ─────────────────────────────────────────────
  const openHistoryPanel = useCallback(async () => {
    if (!activeWorkspace) return;
    setShowHistoryPanel(true);
    setHistoryLoading(true);
    setHistoryIndex(0);
    setConfirmRestore(false);
    try {
      const entries = await getWorkspaceHistory(activeWorkspace.id, 200);
      setHistoryEntries(entries);
    } finally {
      setHistoryLoading(false);
    }
  }, [activeWorkspace, getWorkspaceHistory]);

  const closeHistoryPanel = useCallback(() => {
    setShowHistoryPanel(false);
    setConfirmRestore(false);
  }, []);

  const handleRestoreHistoryEntry = useCallback(async () => {
    if (!activeWorkspace || !historyEntries[historyIndex]) return;
    setRestoringHistory(true);
    try {
      await restoreHistoryEntry(activeWorkspace.id, historyEntries[historyIndex].id);
      setShowHistoryPanel(false);
      setConfirmRestore(false);
    } finally {
      setRestoringHistory(false);
    }
  }, [activeWorkspace, historyEntries, historyIndex, restoreHistoryEntry]);

  /** Human-friendly relative time label */
  const formatTimeAgo = (date: Date): string => {
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs} hour${diffHrs !== 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Close history panel when switching workspaces
  useEffect(() => {
    setShowHistoryPanel(false);
    setHistoryEntries([]);
    setConfirmRestore(false);
  }, [activeWorkspace?.id]);

  const handleDeleteWorkspace = async (workspaceId: string) => {
    if (confirm('Delete this workspace? You can restore it later from the Archive.')) {
      try {
        await deleteWorkspace(workspaceId);
        // Refresh archive if the panel is open
        if (showArchivePanel) {
          const deleted = await getDeletedWorkspaces();
          setDeletedWorkspaces(deleted);
        }
      } catch (err) {
        // Error is handled by the hook
      }
    }
  };

  const handleToggleArchive = async () => {
    if (!showArchivePanel) {
      setArchiveLoading(true);
      setShowArchivePanel(true);
      try {
        const deleted = await getDeletedWorkspaces();
        setDeletedWorkspaces(deleted);
      } catch (err) {
        console.error('Failed to load deleted workspaces:', err);
      } finally {
        setArchiveLoading(false);
      }
    } else {
      setShowArchivePanel(false);
      setSelectedArchiveIds(new Set());
    }
  };

  const handleToggleArchiveSelection = (archiveId: string) => {
    setSelectedArchiveIds((prev) => {
      const next = new Set(prev);
      if (next.has(archiveId)) {
        next.delete(archiveId);
      } else {
        next.add(archiveId);
      }
      return next;
    });
  };

  const handleRestoreSelected = async () => {
    if (selectedArchiveIds.size === 0) return;
    try {
      await restoreDeletedWorkspaces(Array.from(selectedArchiveIds));
      setSelectedArchiveIds(new Set());
      // Refresh the archive list
      const deleted = await getDeletedWorkspaces();
      setDeletedWorkspaces(deleted);
    } catch (err) {
      // Error handled by hook
    }
  };

  const handlePermanentlyDeleteSelected = async () => {
    if (selectedArchiveIds.size === 0) return;
    if (!confirm(`Permanently delete ${selectedArchiveIds.size} workspace(s)? This cannot be undone.`)) return;
    try {
      await permanentlyDeleteWorkspaces(Array.from(selectedArchiveIds));
      setSelectedArchiveIds(new Set());
      const deleted = await getDeletedWorkspaces();
      setDeletedWorkspaces(deleted);
    } catch (err) {
      // Error handled by hook
    }
  };

  const handleSignOut = async () => {
    if (onSignOut) {
      await onSignOut();
    }
  };

  return (
    <div style={styles.container}>
      {/* Sidebar */}
      <div
        style={{
          ...styles.sidebar,
          width: sidebarOpen ? SIDEBAR_WIDTH : 0,
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? 'auto' : 'none',
        }}
      >
        {/* Header */}
        <div style={styles.sidebarHeader}>
          <div style={styles.logo}>
            <svg width="20" height="20" viewBox="0 0 128 128" fill="none">
              <rect x="10" y="30" width="70" height="50" rx="8" fill="#fff" fillOpacity=".5" />
              <rect x="30" y="20" width="70" height="50" rx="8" fill="#fff" fillOpacity=".75" />
              <rect x="48" y="10" width="70" height="50" rx="8" fill="#fff" />
            </svg>
          </div>
          <h1 style={styles.sidebarTitle}>TabFlow</h1>
        </div>

        {/* Spaces Section */}
        <div style={styles.spacesSection}>
          <div style={styles.spacesHeader}>
            <h2 style={styles.spacesTitle}>Spaces</h2>
            <button
              style={styles.addButton}
              onClick={() => setShowNewWorkspaceForm(true)}
              title="Create new workspace"
            >
              +
            </button>
          </div>

          {/* Workspaces List.
              Note: we intentionally do NOT attach a container-level onDragOver/onDrop
              for "drop at end" — the 4px flex gap between items would register as
              container space (e.target === e.currentTarget) and cause the drop
              indicator to flicker to the bottom whenever the cursor crossed a gap.
              Per-item above/below handling (see handleDragOver) already covers the
              "drop at end" case: hovering the bottom half of the last workspace
              inserts below it, which is the end of the list. */}
          <div style={styles.workspacesList}>
            {workspaces.map((ws) => (
              <WorkspaceSidebarItem
                key={ws.id}
                workspace={ws}
                isActive={ws.isActive}
                isDragOver={dragOverWorkspaceId === ws.id}
                dragOverPosition={dragOverPosition}
                dragIndicatorColor={workspaces.find((w) => w.id === draggedWorkspaceId)?.color ?? '#6c8cff'}
                isBeingDragged={draggedWorkspaceId === ws.id}
                onClick={() => switchWorkspace(ws.id)}
                onDelete={() => handleDeleteWorkspace(ws.id)}
                onRename={(name) => renameWorkspace(ws.id, name)}
                onChangeColor={(color) => changeWorkspaceColor(ws.id, color)}
                onChangeShortName={(shortName) => changeShortName(ws.id, shortName)}
                onDragStart={() => handleDragStart(ws.id)}
                onDragOver={(e) => handleDragOver(e, ws.id)}
                onDrop={(e) => handleDrop(ws.id, e)}
                onDragEnd={handleDragEnd}
                stats={workspaceStats[ws.id]}
              />
            ))}
          </div>

          {/* New Workspace Form */}
          {showNewWorkspaceForm && (
            <div style={styles.newWorkspaceForm}>
              <input
                style={styles.input}
                type="text"
                placeholder="Workspace name..."
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateWorkspace()}
                autoFocus
              />
              <div style={styles.colorPicker}>
                {COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    style={{
                      ...styles.colorOption,
                      backgroundColor: color,
                      border: newWorkspaceColor === color ? '2px solid #fff' : 'none',
                    }}
                    onClick={() => setNewWorkspaceColor(color)}
                    title={color}
                  />
                ))}
              </div>
              <div style={styles.customColorRow}>
                <label style={styles.customColorLabel}>Custom:</label>
                <input
                  type="color"
                  value={newWorkspaceColor}
                  onChange={(e) => setNewWorkspaceColor(e.target.value)}
                  style={styles.customColorInput}
                  title="Pick a custom color"
                />
                <span style={styles.customColorHex}>{newWorkspaceColor}</span>
              </div>
              <div style={styles.formButtons}>
                <button style={styles.primaryButton} onClick={handleCreateWorkspace}>
                  Create
                </button>
                <button
                  style={{ ...styles.secondaryButton }}
                  onClick={() => setShowNewWorkspaceForm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Archive Section (Recycle Bin) */}
        <div style={styles.archiveSection}>
          <div style={styles.spacesHeader}>
            <h2
              style={{ ...styles.spacesTitle, cursor: 'pointer', userSelect: 'none' as const }}
              onClick={handleToggleArchive}
              title={showArchivePanel ? 'Hide deleted workspaces' : 'Show deleted workspaces'}
            >
              {showArchivePanel ? '▾' : '▸'} Archive
            </h2>
          </div>
          {showArchivePanel && (
            <div style={{ padding: '0 12px 8px' }}>
              {archiveLoading ? (
                <div style={{ color: '#6b7084', fontSize: '12px', padding: '8px 0' }}>Loading...</div>
              ) : deletedWorkspaces.length === 0 ? (
                <div style={{ color: '#6b7084', fontSize: '12px', padding: '8px 0' }}>No deleted workspaces</div>
              ) : (
                <>
                  <div style={{ maxHeight: '200px', overflowY: 'auto' as const, marginBottom: '8px' }}>
                    {deletedWorkspaces.map((dw) => (
                      <label
                        key={dw.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 4px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          color: '#c9cdd8',
                          backgroundColor: selectedArchiveIds.has(dw.id) ? 'rgba(108, 140, 255, 0.15)' : 'transparent',
                        }}
                        onMouseEnter={(e) => {
                          if (!selectedArchiveIds.has(dw.id)) {
                            (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor = selectedArchiveIds.has(dw.id) ? 'rgba(108, 140, 255, 0.15)' : 'transparent';
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedArchiveIds.has(dw.id)}
                          onChange={() => handleToggleArchiveSelection(dw.id)}
                          style={{ accentColor: '#6c8cff', flexShrink: 0 }}
                        />
                        <div
                          style={{
                            width: '10px',
                            height: '10px',
                            borderRadius: '50%',
                            backgroundColor: dw.workspace?.color || '#6c8cff',
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                          <div style={{ whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {dw.workspace?.name || 'Unnamed'}
                          </div>
                          <div style={{ fontSize: '11px', color: '#6b7084' }}>
                            {dw.tabs?.length || 0} tab{(dw.tabs?.length || 0) !== 1 ? 's' : ''} · {new Date(dw.deletedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                  {selectedArchiveIds.size > 0 && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={handleRestoreSelected}
                        style={{
                          flex: 1,
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: 'none',
                          background: '#6c8cff',
                          color: '#fff',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        title="Restore selected workspaces"
                      >
                        Restore ({selectedArchiveIds.size})
                      </button>
                      <button
                        onClick={handlePermanentlyDeleteSelected}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid rgba(255, 107, 157, 0.3)',
                          background: 'transparent',
                          color: '#ff6b9d',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        title="Permanently delete selected"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer - User Info */}
        <div style={styles.sidebarFooter}>
          <div style={styles.userEmail}>{user?.email || 'Not signed in'}</div>
          <button style={styles.signOutButton} onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </div>

      {/* Collapse/Expand Toggle */}
      <button
        style={{
          ...styles.toggleButton,
          left: sidebarOpen ? SIDEBAR_WIDTH - 12 : 0,
        }}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title={sidebarOpen ? 'Collapse' : 'Expand'}
      >
        {sidebarOpen ? '‹' : '›'}
      </button>

      {/* Main Content Area */}
      <div style={styles.mainContent}>
        {/* Passphrase mismatch banner — sync halted to protect cloud data */}
        {passphraseMismatch && (
          <div style={styles.mismatchBanner}>
            <div style={styles.mismatchBannerContent}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <path d="M12 2L1 21h22L12 2zm0 4.83L19.17 19H4.83L12 6.83zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" fill="#dc2626"/>
              </svg>
              <span style={styles.mismatchBannerText}>{passphraseMismatch}</span>
            </div>
          </div>
        )}

        {/* Resume Working Here banner (inactive device) */}
        {!isActiveDevice && (
          <div style={styles.resumeBanner}>
            <div style={styles.resumeBannerContent}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="#3b82f6"/>
              </svg>
              <span style={styles.resumeBannerText}>
                Another device{inactiveClaimedBy ? ` (${inactiveClaimedBy})` : ''} is currently active. Changes you make here won't sync until you resume.
              </span>
              <button
                style={styles.resumeButton}
                onClick={handleResumeHere}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2563eb';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#3b82f6';
                }}
              >
                Resume Working Here
              </button>
            </div>
          </div>
        )}

        {/* Content Header */}
        {activeWorkspace && (
          <div style={styles.contentHeader}>
            <div style={styles.contentHeaderLeft}>
              <div
                style={{
                  ...styles.workspaceColorDot,
                  backgroundColor: activeWorkspace.color,
                }}
              />
              <h1 style={styles.contentTitle}>{activeWorkspace.name}</h1>
            </div>
            {/* Search bar */}
            <div ref={searchRef} style={styles.searchContainer}>
              <div style={styles.searchInputWrapper}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="7" cy="7" r="5.5" stroke="#8b8fa3" strokeWidth="1.5"/>
                  <path d="M11 11L14 14" stroke="#8b8fa3" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search all workspaces...  (Ctrl+K)"
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  onFocus={() => { setSearchFocused(true); if (searchResults.length > 0) setShowSearchResults(true); }}
                  onBlur={() => setSearchFocused(false)}
                  style={styles.searchInput}
                />
                {searchQuery && (
                  <button
                    style={styles.searchClear}
                    onMouseDown={(e) => { e.preventDefault(); setSearchQuery(''); setSearchResults([]); setShowSearchResults(false); }}
                  >
                    ✕
                  </button>
                )}
              </div>
              {showSearchResults && searchResults.length > 0 && (
                <div style={styles.searchDropdown}>
                  {searchResults.map((result, i) => (
                    <button
                      key={`${result.tab.id}-${i}`}
                      style={{
                        ...styles.searchResultItem,
                        backgroundColor: i === selectedSearchIndex ? 'rgba(108, 140, 255, 0.12)' : 'transparent',
                      }}
                      onMouseDown={() => handleSearchResultClick(result)}
                      onMouseEnter={() => setSelectedSearchIndex(i)}
                    >
                      <div style={styles.searchResultLeft}>
                        {result.tab.faviconUrl ? (
                          <img src={result.tab.faviconUrl} style={styles.searchResultFavicon} alt="" />
                        ) : (
                          <div style={styles.searchResultFaviconPlaceholder} />
                        )}
                        <div style={styles.searchResultText}>
                          <span style={styles.searchResultTitle}>{result.tab.title || result.tab.url}</span>
                          <span style={styles.searchResultUrl}>{result.tab.url}</span>
                        </div>
                      </div>
                      <span style={{ ...styles.searchResultWorkspace, borderColor: result.workspace.color || '#6c8cff' }}>
                        <span style={{ ...styles.sidebarDot, backgroundColor: result.workspace.color || '#6c8cff', width: '6px', height: '6px' }} />
                        {result.workspace.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {showSearchResults && searchResults.length === 0 && searchQuery.trim().length > 0 && (
                <div style={styles.searchDropdown}>
                  <div style={styles.searchNoResults}>No tabs found matching "{searchQuery}"</div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={styles.tabCount}>{tabs.length} tabs</span>
              {systemMemory.total > 0 && (
                <div style={styles.memoryBlock}>
                  <span style={styles.memoryLine}>System {formatBytes(systemMemory.total - systemMemory.available)}/{formatBytes(systemMemory.total)}</span>
                  {chromeMemory > 0 && (
                    <span style={styles.memoryLine}>Chrome {formatBytes(chromeMemory)}/{formatBytes(systemMemory.total - systemMemory.available)}</span>
                  )}
                </div>
              )}
              <button
                data-history-toggle
                title="Workspace history"
                style={{
                  ...styles.historyButton,
                  ...(showHistoryPanel ? styles.historyButtonActive : {}),
                }}
                onClick={() => showHistoryPanel ? setShowHistoryPanel(false) : openHistoryPanel()}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M8 3.5V8L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 8C2 4.686 4.686 2 8 2C11.314 2 14 4.686 14 8C14 11.314 11.314 14 8 14C5.6 14 3.52 12.6 2.6 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M2 12.5V10.5H4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* History Rewind Panel */}
        {showHistoryPanel && activeWorkspace && (
          <div ref={historyPanelRef} style={styles.historyPanel}>
            {historyLoading && (
              <div style={styles.historyEmpty}>Loading history...</div>
            )}
            {!historyLoading && historyEntries.length === 0 && (
              <div style={styles.historyEmpty}>
                No history yet. Snapshots are saved automatically as you browse.
              </div>
            )}
            {!historyLoading && historyEntries.length > 0 && (() => {
              const entry = historyEntries[historyIndex];
              if (!entry) return null;
              const timeLabel = formatTimeAgo(new Date(entry.timestamp));
              const canRewind = historyIndex < historyEntries.length - 1;
              const canForward = historyIndex > 0;

              return (
                <>
                  {/* Header */}
                  <div style={styles.historyPanelHeader}>
                    <span style={styles.historyPanelTitle}>Previously open</span>
                    <div style={styles.historyPanelHeaderRight}>
                      <span style={styles.historyEntryTabCount}>
                        {historyIndex + 1} / {historyEntries.length}
                      </span>
                    </div>
                  </div>

                  {/* Tab list for current entry */}
                  <div style={styles.historyPanelBody}>
                    {entry.tabs.map((t, i) => (
                      <div key={i} style={styles.historyTab}>
                        {t.faviconUrl ? (
                          <img src={t.faviconUrl} style={styles.historyTabFavicon} alt="" />
                        ) : (
                          <div style={styles.historyTabFaviconPlaceholder} />
                        )}
                        <span style={styles.historyTabTitle}>{t.title || t.url}</span>
                      </div>
                    ))}
                  </div>

                  {/* Navigation bar: rewind / time / forward */}
                  <div style={styles.historyNavBar}>
                    <button
                      style={{
                        ...styles.historyNavButton,
                        opacity: canRewind ? 1 : 0.3,
                        cursor: canRewind ? 'pointer' : 'default',
                      }}
                      disabled={!canRewind}
                      onClick={() => { setHistoryIndex((i) => i + 1); setConfirmRestore(false); }}
                      title="Older"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7 3L2 8L7 13V3ZM14 3L9 8L14 13V3Z"/></svg>
                    </button>
                    <span style={styles.historyNavTime}>{timeLabel}</span>
                    <button
                      style={{
                        ...styles.historyNavButton,
                        opacity: canForward ? 1 : 0.3,
                        cursor: canForward ? 'pointer' : 'default',
                      }}
                      disabled={!canForward}
                      onClick={() => { setHistoryIndex((i) => i - 1); setConfirmRestore(false); }}
                      title="Newer"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M9 3L14 8L9 13V3ZM2 3L7 8L2 13V3Z"/></svg>
                    </button>
                  </div>

                  {/* Action bar: cancel / restore */}
                  <div style={styles.historyActionBar}>
                    {!confirmRestore ? (
                      <>
                        <button style={styles.historyCancelButton} onClick={closeHistoryPanel}>
                          Cancel
                        </button>
                        <button
                          style={styles.historyRestoreButton}
                          onClick={() => setConfirmRestore(true)}
                        >
                          Restore {entry.tabs.length} tab{entry.tabs.length !== 1 ? 's' : ''}
                        </button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: '12px', color: '#f59e0b', fontWeight: 500 }}>
                          Replace current tabs?
                        </span>
                        <button
                          style={styles.historyRestoreConfirm}
                          disabled={restoringHistory}
                          onClick={handleRestoreHistoryEntry}
                        >
                          {restoringHistory ? 'Restoring...' : 'Yes, restore'}
                        </button>
                        <button
                          style={styles.historyCancelButton}
                          onClick={() => setConfirmRestore(false)}
                        >
                          No
                        </button>
                      </>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Content Body */}
        <div style={styles.contentBody}>
          {loading && (
            <div style={styles.emptyState}>
              <div style={styles.emptyStateIcon}>⏳</div>
              <div style={styles.emptyStateText}>Loading workspaces...</div>
            </div>
          )}

          {error && (
            <div style={styles.errorState}>
              <div style={styles.emptyStateIcon}>⚠️</div>
              <div style={styles.emptyStateText}>Error: {error}</div>
            </div>
          )}

          {!loading && !error && workspaces.length === 0 && (
            <div style={styles.emptyState}>
              <div style={styles.emptyStateIcon}>📑</div>
              <div style={styles.emptyStateTitle}>No workspaces yet</div>
              <div style={styles.emptyStateSubtitle}>
                Create your first workspace to start organizing your tabs
              </div>
            </div>
          )}

          {!loading && !error && activeWorkspace && tabs.length === 0 && (
            <div style={styles.emptyState}>
              <div style={styles.emptyStateIcon}>📭</div>
              <div style={styles.emptyStateTitle}>Workspace is empty</div>
              <div style={styles.emptyStateSubtitle}>
                Add tabs to {activeWorkspace.name} to see them here
              </div>
            </div>
          )}

          {!loading && !error && tabs.length > 0 && (
            <div style={{ width: '100%' }}>
              {/* Action bar */}
              <div style={styles.moveBar}>
                {/* Left side: selection info + select all */}
                <span style={styles.moveBarText}>
                  {selectedTabIds.size > 0
                    ? `${selectedTabIds.size} tab${selectedTabIds.size > 1 ? 's' : ''} selected`
                    : 'Select tabs'}
                </span>
                <button
                  style={styles.actionBarButton}
                  onClick={() => {
                    if (selectedTabIds.size === tabs.length) {
                      setSelectedTabIds(new Set());
                    } else {
                      setSelectedTabIds(new Set(tabs.map((t) => t.id)));
                    }
                  }}
                >
                  {selectedTabIds.size === tabs.length ? 'Deselect All' : 'Select All'}
                </button>

                {selectedTabIds.size > 0 && (
                  <button
                    style={styles.actionBarButton}
                    onClick={() => setSelectedTabIds(new Set())}
                  >
                    Clear
                  </button>
                )}

                {/* Divider */}
                <div style={{ width: '1px', height: '20px', backgroundColor: '#3d4150', margin: '0 4px' }} />

                {/* Move to */}
                <div style={{ position: 'relative' }}>
                  <button
                    style={{
                      ...styles.actionBarButton,
                      opacity: selectedTabIds.size > 0 ? 1 : 0.4,
                      cursor: selectedTabIds.size > 0 ? 'pointer' : 'default',
                    }}
                    disabled={selectedTabIds.size === 0}
                    onClick={() => { setShowMovePopup(!showMovePopup); setShowDuplicatePopup(false); }}
                  >
                    Move to...
                  </button>
                  {showMovePopup && (
                    <div ref={movePopupRef} style={styles.movePopup}>
                      <div style={styles.movePopupTitle}>Move to workspace</div>
                      {workspaces
                        .filter((ws) => ws.id !== activeWorkspace?.id)
                        .map((ws) => (
                          <button
                            key={ws.id}
                            style={styles.movePopupItem}
                            onClick={() => handleMoveToWorkspace(ws.id)}
                          >
                            <span style={{ ...styles.sidebarDot, backgroundColor: ws.color }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{ws.name}</span>
                            <span style={{ fontSize: '11px', color: '#8b8fa3' }}>{ws.tabCount}</span>
                          </button>
                        ))}
                      <div style={styles.contextMenuDivider} />
                      <div style={{ padding: '8px 12px' }}>
                        <div style={{ fontSize: '11px', color: '#8b8fa3', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
                          Create new workspace
                        </div>
                        <input
                          type="text"
                          placeholder="Workspace name"
                          value={moveNewWorkspaceName}
                          onChange={(e) => setMoveNewWorkspaceName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleMoveToNewWorkspace(); }}
                          style={{ ...styles.input, marginBottom: '6px', fontSize: '12px', padding: '6px 8px' }}
                        />
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '6px', flexWrap: 'wrap' as const }}>
                          {COLOR_PALETTE.slice(0, 10).map((c) => (
                            <div
                              key={c}
                              onClick={() => setMoveNewWorkspaceColor(c)}
                              style={{
                                width: '16px', height: '16px', borderRadius: '3px',
                                backgroundColor: c, cursor: 'pointer',
                                outline: moveNewWorkspaceColor === c ? '2px solid #fff' : 'none',
                                outlineOffset: '1px',
                              }}
                            />
                          ))}
                        </div>
                        <button
                          style={{ ...styles.primaryButton, fontSize: '11px', padding: '5px 0', opacity: moveNewWorkspaceName.trim() ? 1 : 0.5 }}
                          disabled={!moveNewWorkspaceName.trim()}
                          onClick={handleMoveToNewWorkspace}
                        >
                          Create & Move
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Duplicate to */}
                <div style={{ position: 'relative' }}>
                  <button
                    style={{
                      ...styles.actionBarButton,
                      opacity: selectedTabIds.size > 0 ? 1 : 0.4,
                      cursor: selectedTabIds.size > 0 ? 'pointer' : 'default',
                    }}
                    disabled={selectedTabIds.size === 0}
                    onClick={() => { setShowDuplicatePopup(!showDuplicatePopup); setShowMovePopup(false); }}
                  >
                    Duplicate to...
                  </button>
                  {showDuplicatePopup && (
                    <div ref={duplicatePopupRef} style={styles.movePopup}>
                      <div style={styles.movePopupTitle}>Duplicate to workspace</div>
                      {workspaces
                        .filter((ws) => ws.id !== activeWorkspace?.id)
                        .map((ws) => (
                          <button
                            key={ws.id}
                            style={styles.movePopupItem}
                            onClick={() => handleDuplicateToWorkspace(ws.id)}
                          >
                            <span style={{ ...styles.sidebarDot, backgroundColor: ws.color }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{ws.name}</span>
                            <span style={{ fontSize: '11px', color: '#8b8fa3' }}>{ws.tabCount}</span>
                          </button>
                        ))}
                    </div>
                  )}
                </div>

                {/* Delete Selected */}
                <div style={{ position: 'relative' }}>
                  {!showDeleteSelectedConfirm ? (
                    <button
                      style={{
                        ...styles.actionBarButton,
                        ...(selectedTabIds.size > 0 ? { color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)' } : {}),
                        opacity: selectedTabIds.size > 0 ? 1 : 0.4,
                        cursor: selectedTabIds.size > 0 ? 'pointer' : 'default',
                      }}
                      disabled={selectedTabIds.size === 0}
                      onClick={() => setShowDeleteSelectedConfirm(true)}
                    >
                      Delete Selected
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 500, whiteSpace: 'nowrap' as const }}>
                        Delete {selectedTabIds.size} tab{selectedTabIds.size > 1 ? 's' : ''}?
                      </span>
                      <button
                        style={{ ...styles.actionBarButton, background: '#ef4444', color: '#fff', borderColor: '#ef4444' }}
                        onClick={handleDeleteSelected}
                      >
                        Yes
                      </button>
                      <button
                        style={styles.actionBarButton}
                        onClick={() => setShowDeleteSelectedConfirm(false)}
                      >
                        No
                      </button>
                    </div>
                  )}
                </div>

                {/* Right side: Close All */}
                <div style={{ marginLeft: 'auto', position: 'relative' }}>
                  {!showCloseAllConfirm ? (
                    <button
                      style={{
                        ...styles.actionBarButton,
                        color: '#ef4444',
                        borderColor: 'rgba(239, 68, 68, 0.3)',
                        background: 'rgba(239, 68, 68, 0.1)',
                      }}
                      onClick={() => setShowCloseAllConfirm(true)}
                    >
                      Close All Tabs
                    </button>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 500, whiteSpace: 'nowrap' as const }}>
                        Delete all {tabs.length} tabs?
                      </span>
                      <button
                        style={{ ...styles.actionBarButton, background: '#ef4444', color: '#fff', borderColor: '#ef4444' }}
                        onClick={async () => {
                          if (activeWorkspace) await closeAllTabs(activeWorkspace.id);
                          setShowCloseAllConfirm(false);
                          setSelectedTabIds(new Set());
                        }}
                      >
                        Yes
                      </button>
                      <button
                        style={styles.actionBarButton}
                        onClick={() => setShowCloseAllConfirm(false)}
                      >
                        No
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div style={styles.tabsGrid} ref={gridRef}>
                {localTabs.map((tab) => (
                  <div
                    key={tab.id}
                    onMouseDown={(e) => handleTabDragStart(e, tab.id)}
                    style={{
                      visibility: dragTabId === tab.id ? 'hidden' : 'visible',
                      transition: dragTabId ? 'transform 0.2s ease' : 'none',
                      cursor: dragTabId ? 'grabbing' : 'grab',
                      userSelect: 'none',
                    }}
                  >
                    <TabCard
                      tab={tab}
                      accentColor={activeWorkspace?.color || '#6c8cff'}
                      selected={selectedTabIds.has(tab.id)}
                      thumbnailUrl={thumbnails[tab.url]}
                      onToggleSelect={() => toggleTabSelection(tab.id)}
                      onClick={() => { if (!didDragRef.current) handleOpenTab(tab); }}
                      onRemove={() => handleRemoveTab(tab.id)}
                    />
                  </div>
                ))}
              </div>

              {/* Floating drag tile — follows the cursor */}
              {dragTabId && dragPos && (() => {
                const draggedTab = localTabs.find((t) => t.id === dragTabId);
                const state = dragRef.current;
                if (!draggedTab || !state) return null;
                return (
                  <div
                    style={{
                      position: 'fixed',
                      left: dragPos.x,
                      top: dragPos.y,
                      width: state.cardWidth,
                      zIndex: 9999,
                      pointerEvents: 'none',
                      transform: 'scale(1.03)',
                      boxShadow: '0 0 0 2px rgba(255, 200, 120, 0.45), 0 6px 20px rgba(255, 180, 80, 0.35), 0 4px 12px rgba(0, 0, 0, 0.4)',
                      borderRadius: '8px',
                    }}
                  >
                    <TabCard
                      tab={draggedTab}
                      accentColor={activeWorkspace?.color || '#6c8cff'}
                      selected={selectedTabIds.has(draggedTab.id)}
                      thumbnailUrl={thumbnails[draggedTab.url]}
                      onToggleSelect={() => {}}
                      onClick={() => {}}
                      onRemove={() => {}}
                    />
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── Workspace Sidebar Item ─── */

interface WorkspaceSidebarItemProps {
  workspace: WorkspaceWithCount;
  isActive: boolean;
  isDragOver: boolean;
  dragOverPosition: 'above' | 'below';
  dragIndicatorColor: string;
  isBeingDragged: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onChangeColor: (color: string) => void;
  onChangeShortName: (shortName: string) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  stats?: { tabCount: number; memoryBytes: number; audibleCount: number };
}

const WorkspaceSidebarItem: React.FC<WorkspaceSidebarItemProps> = ({
  workspace,
  isActive,
  isDragOver,
  dragOverPosition,
  dragIndicatorColor,
  isBeingDragged,
  onClick,
  onDelete,
  onRename,
  onChangeColor,
  onChangeShortName,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  stats,
}) => {
  const [hover, setHover] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(workspace.name);
  const [showMenu, setShowMenu] = useState(false);
  const [editShortName, setEditShortName] = useState(workspace.shortName || '');
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  React.useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(workspace.name);
    setIsEditing(true);
  };

  const handleRenameSubmit = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== workspace.name) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleRenameSubmit();
    if (e.key === 'Escape') setIsEditing(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={(e) => { e.preventDefault(); onDrop(e); }}
      onDragEnd={onDragEnd}
      style={{
        ...styles.sidebarWorkspaceItem,
        backgroundColor: isActive ? `${workspace.color}18` : 'transparent',
        borderLeftColor: isActive ? workspace.color : 'transparent',
        position: 'relative' as const,
        opacity: isBeingDragged ? 0.35 : 1,
        transition: 'opacity 0.12s, background-color 0.15s',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      onContextMenu={handleContextMenu}
    >
      {/* Drop-position indicator: a glowing bar rendered above or below
          the item depending on where the cursor is within it. Styled to match
          the backlit glow effect used on tab tiles — uses the dragged
          workspace's color with layered soft blur for a "lit LED" look. */}
      {isDragOver && (
        <div
          style={{
            position: 'absolute',
            left: '8px',
            right: '8px',
            height: '1.5px',
            borderRadius: '999px',
            backgroundColor: dragIndicatorColor,
            // Bright inner core fading to a wide soft halo — mirrors the
            // pressed-tile glow (§ TabTile `glowStyle`) but scaled for a thin bar.
            boxShadow: [
              `0 0 3px 0px ${dragIndicatorColor}`,
              `0 0 8px 0px ${dragIndicatorColor}B0`,
              `0 0 16px 1px ${dragIndicatorColor}70`,
              `0 0 32px 3px ${dragIndicatorColor}40`,
              `0 0 56px 5px ${dragIndicatorColor}20`,
            ].join(', '),
            pointerEvents: 'none',
            top: dragOverPosition === 'above' ? '-2px' : 'auto',
            bottom: dragOverPosition === 'below' ? '-2px' : 'auto',
            zIndex: 10,
          }}
        />
      )}
      <div style={styles.sidebarWorkspaceRow}>
        {/* Drag handle */}
        <div style={{ ...styles.dragHandle, opacity: hover ? 0.5 : 0 }} title="Drag to reorder">⠿</div>
        <div
          style={{
            ...styles.sidebarDot,
            backgroundColor: workspace.color,
          }}
        />
        {isEditing ? (
          <input
            style={styles.renameInput}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span
            style={{
              ...styles.sidebarWorkspaceName,
              color: workspace.color,
            }}
            onDoubleClick={handleDoubleClick}
            title="Double-click to rename"
          >
            {workspace.name}
          </span>
        )}
        <span style={styles.sidebarTabCount}>
          {workspace.tabCount}
          {stats?.audibleCount && stats.audibleCount > 0 ? (
            <span style={styles.sidebarAudibleIcon} title="Playing audio">♪</span>
          ) : null}
        </span>
        {!isEditing && (
          <button
            style={{
              ...styles.sidebarMenuButton,
              opacity: hover || showMenu ? 1 : 0.4,
            }}
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            title="Workspace options"
          >
            ⋯
          </button>
        )}
      </div>

      {/* Context Menu */}
      {showMenu && (
        <div ref={menuRef} style={styles.contextMenu} onClick={(e) => e.stopPropagation()}>
          <button
            style={styles.contextMenuItem}
            onClick={() => { setShowMenu(false); setEditName(workspace.name); setIsEditing(true); }}
          >
            Rename
          </button>
          <div style={styles.contextMenuDivider} />
          <div style={styles.contextMenuLabel}>Color</div>
          <div style={styles.contextMenuColors}>
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                style={{
                  ...styles.contextColorOption,
                  backgroundColor: color,
                  border: workspace.color === color ? '2px solid #fff' : '2px solid transparent',
                }}
                onClick={() => { onChangeColor(color); setShowMenu(false); }}
                title={color}
              />
            ))}
          </div>
          <div style={styles.customColorRow}>
            <label style={styles.customColorLabel}>Custom:</label>
            <input
              type="color"
              value={workspace.color}
              onChange={(e) => onChangeColor(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              style={styles.customColorInput}
              title="Pick a custom color"
            />
            <span style={styles.customColorHex}>{workspace.color}</span>
          </div>
          <div style={styles.contextMenuDivider} />
          <div style={styles.contextMenuLabel}>Icon label</div>
          <div style={styles.shortNameRow}>
            <input
              type="text"
              maxLength={3}
              placeholder="Auto"
              value={editShortName}
              onChange={(e) => setEditShortName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onChangeShortName(editShortName.trim());
                  setShowMenu(false);
                }
                if (e.key === 'Escape') setShowMenu(false);
              }}
              onClick={(e) => e.stopPropagation()}
              style={styles.shortNameInput}
            />
            <button
              style={styles.shortNameSave}
              onClick={() => { onChangeShortName(editShortName.trim()); setShowMenu(false); }}
            >
              Save
            </button>
            {editShortName && (
              <button
                style={styles.shortNameClear}
                onClick={() => { setEditShortName(''); onChangeShortName(''); setShowMenu(false); }}
                title="Reset to auto"
              >
                Reset
              </button>
            )}
          </div>
          <div style={styles.contextMenuDivider} />
          <button
            style={{ ...styles.contextMenuItem, color: '#f87171' }}
            onClick={() => { setShowMenu(false); onDelete(); }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

/* ─── Tab Card ─── */

interface TabCardProps {
  tab: Tab;
  accentColor: string;
  selected: boolean;
  thumbnailUrl?: string;
  onToggleSelect: () => void;
  onClick: () => void;
  onRemove: () => void;
}

const TabCard: React.FC<TabCardProps> = ({ tab, accentColor, selected, thumbnailUrl, onToggleSelect, onClick, onRemove }) => {
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [thumbError, setThumbError] = useState(false);

  const getFaviconUrl = (url: string, faviconUrl?: string): string => {
    if (faviconUrl) return faviconUrl;
    try {
      const urlObj = new URL(url);
      return `https://www.google.com/s2/favicons?sz=32&domain=${urlObj.hostname}`;
    } catch {
      return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%238b8fa3"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>';
    }
  };

  const truncateUrl = (url: string, maxLength: number = 50): string => {
    return url.length > maxLength ? url.substring(0, maxLength) + '...' : url;
  };

  const showThumbnail = thumbnailUrl && !thumbError;

  // Backlit glow effect:
  // - No hover: no glow (tile flat, dark)
  // - Hover: tight glow leaking around edges (tile flush against background)
  // - Pressed: tile lifts off — glow spreads wide, dark shadow cast below, slight scale-up
  const glowStyle: React.CSSProperties = pressed
    ? {
        border: '1px solid transparent',
        boxShadow: [
          // All blur, no spread — pure soft glow like a backlit LED
          `0 0 20px 0px ${accentColor}50`,
          `0 0 40px 0px ${accentColor}35`,
          `0 0 70px 0px ${accentColor}25`,
          `0 0 110px 0px ${accentColor}15`,
          `0 0 160px 0px ${accentColor}08`,
          // Cast shadow — grounds the lift
          `0 10px 30px 0px rgba(0, 0, 0, 0.4)`,
        ].join(', '),
        transform: 'translateY(-5px) scale(1.015)',
        filter: 'brightness(1.08)',
      }
    : hover
    ? {
        border: '1px solid transparent',
        boxShadow: `0 0 12px 0px ${accentColor}30, 0 0 25px 0px ${accentColor}15`,
      }
    : {};

  return (
    <div
      style={{
        ...styles.tabCard,
        borderTop: `3px solid ${accentColor}`,
        ...(hover ? styles.tabCardHover : {}),
        ...glowStyle,
        ...(selected ? { outline: `2px solid ${accentColor}`, outlineOffset: '-2px' } : {}),
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseDown={(e) => {
        // Only glow on left-click, and not on checkbox/button clicks
        if (e.button === 0) setPressed(true);
      }}
      onMouseUp={() => setPressed(false)}
      onClick={onClick}
    >
      {/* Thumbnail preview area */}
      <div style={styles.tabThumbnailArea}>
        {showThumbnail ? (
          <img
            src={thumbnailUrl}
            style={styles.tabThumbnailImg}
            alt=""
            onError={() => setThumbError(true)}
          />
        ) : (
          <div style={styles.tabThumbnailPlaceholder}>
            <img
              src={getFaviconUrl(tab.url, tab.faviconUrl)}
              style={{ width: '32px', height: '32px', borderRadius: '4px', opacity: 0.5 }}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        {/* Overlay controls on thumbnail */}
        <div style={{
          ...styles.tabThumbnailOverlay,
          opacity: 1,
        }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            onClick={(e) => e.stopPropagation()}
            style={styles.tabCheckbox}
            title="Select tab"
          />
          <button
            style={{
              ...styles.tabRemoveButton,
              opacity: hover ? 1 : 0,
              pointerEvents: hover ? 'auto' : 'none',
            }}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            title="Remove tab"
          >
            ✕
          </button>
        </div>
      </div>
      <div style={styles.tabCardContent}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <img
            src={getFaviconUrl(tab.url, tab.faviconUrl)}
            style={{ width: '14px', height: '14px', borderRadius: '2px', flexShrink: 0 }}
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <h3 style={styles.tabTitle}>{tab.title || 'Untitled'}</h3>
        </div>
        <p style={styles.tabUrl}>{truncateUrl(tab.url)}</p>
      </div>
    </div>
  );
};

/* ─── Styles ─── */

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    width: '100vw',
    height: '100vh',
    backgroundColor: '#0f1117',
    color: '#e8eaed',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    overflow: 'hidden',
  },

  /* Sidebar */
  sidebar: {
    width: SIDEBAR_WIDTH,
    backgroundColor: '#1a1d27',
    borderRight: '1px solid #2d3139',
    display: 'flex',
    flexDirection: 'column',
    transition: 'all 0.2s ease-out',
    overflow: 'hidden',
  },

  sidebarHeader: {
    padding: '16px 16px',
    borderBottom: '1px solid #2d3139',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexShrink: 0,
  },

  logo: {
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    background: 'linear-gradient(135deg, #6c8cff, #a78bfa)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  sidebarTitle: {
    fontSize: '16px',
    fontWeight: 700,
    margin: 0,
    color: '#fff',
  },

  spacesSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    padding: '12px 0',
  },

  spacesHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    marginBottom: '8px',
  },

  spacesTitle: {
    fontSize: '12px',
    fontWeight: 600,
    margin: 0,
    color: '#8b8fa3',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },

  addButton: {
    background: 'none',
    border: 'none',
    color: '#8b8fa3',
    cursor: 'pointer',
    fontSize: '16px',
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    transition: 'all 0.15s',
  },

  workspacesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    paddingX: '8px',
    paddingY: 0,
    flex: 1,
    minHeight: 0,
  },

  sidebarWorkspaceItem: {
    padding: '8px 12px',
    cursor: 'pointer',
    borderRadius: '6px',
    borderLeft: '3px solid transparent',
    transition: 'all 0.15s',
  },

  sidebarWorkspaceRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  sidebarDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },

  sidebarWorkspaceName: {
    fontSize: '13px',
    fontWeight: 500,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  sidebarTabCount: {
    fontSize: '11px',
    color: '#8b8fa3',
    backgroundColor: '#2d3139',
    padding: '2px 6px',
    borderRadius: '3px',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
  },

  sidebarMemoryLabel: {
    fontSize: '10px',
    color: '#6b7080',
    borderLeft: '1px solid #3a3f4b',
    paddingLeft: '4px',
  } as React.CSSProperties,

  sidebarAudibleIcon: {
    fontSize: '10px',
    color: '#60a5fa',
    marginLeft: '1px',
  } as React.CSSProperties,

  sidebarMenuButton: {
    background: 'none',
    border: 'none',
    color: '#8b8fa3',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px 4px',
    borderRadius: '3px',
    transition: 'all 0.15s',
    flexShrink: 0,
    lineHeight: 1,
  },

  dragHandle: {
    fontSize: '10px',
    color: '#8b8fa3',
    cursor: 'grab',
    flexShrink: 0,
    transition: 'opacity 0.15s',
    userSelect: 'none' as const,
    lineHeight: 1,
  },

  renameInput: {
    flex: 1,
    fontSize: '13px',
    fontWeight: 500,
    backgroundColor: '#1a1d27',
    border: '1px solid #6c8cff',
    borderRadius: '4px',
    color: '#e8eaed',
    padding: '2px 6px',
    outline: 'none',
    minWidth: 0,
  },

  contextMenu: {
    position: 'absolute' as const,
    top: '100%',
    left: '0px',
    right: '0px',
    zIndex: 100,
    backgroundColor: '#24272f',
    border: '1px solid #3d4150',
    borderRadius: '8px',
    padding: '6px 0',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  },

  contextMenuItem: {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    fontSize: '13px',
    color: '#e8eaed',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background 0.1s',
  },

  contextMenuDivider: {
    height: '1px',
    backgroundColor: '#3d4150',
    margin: '4px 0',
  },

  contextMenuLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#8b8fa3',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    padding: '4px 14px',
  },

  contextMenuColors: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '5px',
    padding: '6px 14px',
  },

  customColorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 14px 6px',
  },

  customColorLabel: {
    fontSize: '11px',
    color: '#8b8fa3',
    flexShrink: 0,
  },

  customColorInput: {
    width: '24px',
    height: '24px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    backgroundColor: 'transparent',
    padding: 0,
    flexShrink: 0,
  },

  customColorHex: {
    fontSize: '11px',
    color: '#8b8fa3',
    fontFamily: 'monospace',
  },

  shortNameRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 14px 6px',
  },

  shortNameInput: {
    width: '50px',
    fontSize: '13px',
    fontWeight: 600,
    textAlign: 'center' as const,
    backgroundColor: '#1a1d27',
    border: '1px solid #3d4150',
    borderRadius: '4px',
    color: '#e8eaed',
    padding: '4px 6px',
    outline: 'none',
    textTransform: 'uppercase' as const,
  },

  shortNameSave: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#6c8cff',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 6px',
  },

  shortNameClear: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#8b8fa3',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 6px',
  },

  contextColorOption: {
    width: '22px',
    height: '22px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },

  newWorkspaceForm: {
    padding: '12px',
    marginX: '8px',
    marginY: '8px',
    backgroundColor: '#24272f',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },

  input: {
    width: '100%',
    padding: '8px 12px',
    fontSize: '13px',
    backgroundColor: '#1a1d27',
    border: '1px solid #3d4150',
    borderRadius: '6px',
    color: '#e8eaed',
    outline: 'none',
    boxSizing: 'border-box',
  },

  colorPicker: {
    display: 'grid',
    gridTemplateColumns: 'repeat(10, 1fr)',
    gap: '4px',
    justifyContent: 'center',
  },

  colorOption: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },

  formButtons: {
    display: 'flex',
    gap: '6px',
  },

  primaryButton: {
    flex: 1,
    padding: '6px 0',
    fontSize: '12px',
    fontWeight: 500,
    backgroundColor: '#6c8cff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },

  secondaryButton: {
    flex: 1,
    padding: '6px 0',
    fontSize: '12px',
    fontWeight: 500,
    backgroundColor: '#2d3139',
    color: '#e8eaed',
    border: '1px solid #3d4150',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },

  archiveSection: {
    borderTop: '1px solid #2d3139',
    padding: '12px 0',
    flexShrink: 0,
  },

  emptyArchive: {
    fontSize: '12px',
    color: '#8b8fa3',
    padding: '0 12px',
    textAlign: 'center',
    fontStyle: 'italic',
  },

  sidebarFooter: {
    padding: '12px 16px',
    borderTop: '1px solid #2d3139',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    flexShrink: 0,
  },

  userEmail: {
    fontSize: '12px',
    color: '#8b8fa3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  signOutButton: {
    padding: '6px 0',
    fontSize: '12px',
    fontWeight: 500,
    backgroundColor: '#2d3139',
    color: '#e8eaed',
    border: '1px solid #3d4150',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },

  toggleButton: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: '24px',
    height: '32px',
    backgroundColor: '#24272f',
    border: '1px solid #3d4150',
    borderRadius: '0 6px 6px 0',
    color: '#8b8fa3',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 600,
    transition: 'all 0.2s ease-out',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Main Content */
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  },

  contentHeader: {
    padding: '24px 32px',
    borderBottom: '1px solid #2d3139',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },

  contentHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },

  workspaceColorDot: {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
  },

  contentTitle: {
    fontSize: '24px',
    fontWeight: 700,
    margin: 0,
    color: '#fff',
  },

  tabCount: {
    fontSize: '13px',
    color: '#8b8fa3',
  },

  memoryBlock: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '2px',
    lineHeight: 1.2,
  } as React.CSSProperties,

  memoryLine: {
    fontSize: '11px',
    color: '#6b7080',
  } as React.CSSProperties,

  mismatchBanner: {
    backgroundColor: '#450a0a',
    borderBottom: '1px solid #7f1d1d',
    padding: '12px 24px',
    flexShrink: 0,
  } as React.CSSProperties,

  mismatchBannerContent: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    maxWidth: '900px',
    margin: '0 auto',
  } as React.CSSProperties,

  mismatchBannerText: {
    fontSize: '13px',
    color: '#fecaca',
    flex: 1,
    lineHeight: 1.5,
  } as React.CSSProperties,

  resumeBanner: {
    backgroundColor: '#1e293b',
    borderBottom: '1px solid #334155',
    padding: '10px 24px',
    flexShrink: 0,
  } as React.CSSProperties,

  resumeBannerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    maxWidth: '900px',
    margin: '0 auto',
  } as React.CSSProperties,

  resumeBannerText: {
    fontSize: '13px',
    color: '#94a3b8',
    flex: 1,
  } as React.CSSProperties,

  resumeButton: {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 16px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background-color 0.15s ease',
  } as React.CSSProperties,

  contentBody: {
    flex: 1,
    overflow: 'auto',
    padding: '32px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },

  tabsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '20px',
    width: '100%',
  },

  tabCard: {
    backgroundColor: '#24272f',
    borderRadius: '8px',
    overflow: 'hidden',
    cursor: 'pointer',
    border: '1px solid #3d4150',
    transition: 'box-shadow 0.2s ease, transform 0.15s ease, background-color 0.2s ease, filter 0.15s ease, border-color 0.2s ease',
    display: 'flex',
    flexDirection: 'column',
  },

  tabCardHover: {
    backgroundColor: '#2d3139',
  },

  tabThumbnailArea: {
    position: 'relative',
    width: '100%',
    height: '120px',
    overflow: 'hidden',
    backgroundColor: '#1a1d27',
    borderBottom: '1px solid #3d4150',
  },

  tabThumbnailImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: 'top center',
    display: 'block',
  },

  tabThumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1d27',
  },

  tabThumbnailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    padding: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 100%)',
    transition: 'opacity 0.15s',
  },

  tabCardHeader: {
    padding: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
  },

  tabFavicon: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    objectFit: 'cover',
  },

  tabRemoveButton: {
    background: 'none',
    border: 'none',
    color: '#f87171',
    cursor: 'pointer',
    fontSize: '14px',
    padding: '4px 8px',
    borderRadius: '4px',
    transition: 'all 0.15s',
  },

  tabCardContent: {
    flex: 1,
    padding: '8px 10px 10px 10px',
    overflow: 'hidden',
  },

  tabTitle: {
    fontSize: '12px',
    fontWeight: 600,
    margin: 0,
    color: '#fff',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0,
  },

  tabUrl: {
    fontSize: '11px',
    color: '#8b8fa3',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  emptyState: {
    textAlign: 'center',
    padding: '60px 40px',
    color: '#8b8fa3',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyStateIcon: {
    fontSize: '64px',
    marginBottom: '16px',
  },

  emptyStateTitle: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#e8eaed',
    marginBottom: '8px',
  },

  emptyStateSubtitle: {
    fontSize: '14px',
    color: '#8b8fa3',
  },

  errorState: {
    textAlign: 'center',
    padding: '60px 40px',
    color: '#f87171',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Tab selection & Move */
  tabCheckbox: {
    width: '16px',
    height: '16px',
    cursor: 'pointer',
    accentColor: '#6c8cff',
    flexShrink: 0,
    margin: 0,
  },

  moveBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 0',
    marginBottom: '16px',
    borderBottom: '1px solid #2d3139',
  },

  moveBarText: {
    fontSize: '13px',
    color: '#e8eaed',
    fontWeight: 500,
  },

  moveButton: {
    padding: '6px 16px',
    fontSize: '12px',
    fontWeight: 600,
    backgroundColor: '#6c8cff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },

  actionBarButton: {
    padding: '5px 12px',
    fontSize: '12px',
    fontWeight: 500,
    backgroundColor: 'transparent',
    color: '#c8cad0',
    border: '1px solid #3d4150',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  moveBarClear: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    backgroundColor: 'transparent',
    color: '#8b8fa3',
    border: '1px solid #3d4150',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },

  movePopup: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    marginTop: '4px',
    width: '260px',
    backgroundColor: '#24272f',
    border: '1px solid #3d4150',
    borderRadius: '8px',
    padding: '6px 0',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    zIndex: 200,
    maxHeight: '400px',
    overflowY: 'auto' as const,
  },

  movePopupTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#8b8fa3',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    padding: '6px 12px',
  },

  movePopupItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px 12px',
    fontSize: '13px',
    color: '#e8eaed',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background 0.1s',
  },

  /* ─── Search ─── */
  searchContainer: {
    position: 'relative' as const,
    flex: 1,
    maxWidth: '420px',
    marginLeft: '20px',
    marginRight: '20px',
  },

  searchInputWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    padding: '7px 12px',
    transition: 'all 0.15s',
  },

  searchInput: {
    flex: 1,
    background: 'none',
    border: 'none',
    outline: 'none',
    color: '#e8eaed',
    fontSize: '13px',
    fontFamily: 'inherit',
    minWidth: 0,
  },

  searchClear: {
    background: 'none',
    border: 'none',
    color: '#8b8fa3',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '2px 4px',
    lineHeight: 1,
    flexShrink: 0,
  },

  searchDropdown: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    right: 0,
    marginTop: '4px',
    backgroundColor: '#24272f',
    border: '1px solid #3d4150',
    borderRadius: '10px',
    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5)',
    maxHeight: '380px',
    overflowY: 'auto' as const,
    zIndex: 200,
    padding: '4px 0',
  },

  searchResultItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    width: '100%',
    padding: '8px 14px',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'background 0.08s',
  },

  searchResultLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
  },

  searchResultFavicon: {
    width: '18px',
    height: '18px',
    borderRadius: '3px',
    flexShrink: 0,
    objectFit: 'cover' as const,
  },

  searchResultFaviconPlaceholder: {
    width: '18px',
    height: '18px',
    borderRadius: '3px',
    backgroundColor: '#3d4150',
    flexShrink: 0,
  },

  searchResultText: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '1px',
    minWidth: 0,
    overflow: 'hidden',
  },

  searchResultTitle: {
    fontSize: '13px',
    color: '#e8eaed',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  searchResultUrl: {
    fontSize: '11px',
    color: '#8b8fa3',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  searchResultWorkspace: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '11px',
    color: '#8b8fa3',
    backgroundColor: 'rgba(255,255,255,0.04)',
    border: '1px solid',
    borderRadius: '4px',
    padding: '2px 8px',
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
  },

  searchNoResults: {
    padding: '16px',
    textAlign: 'center' as const,
    fontSize: '13px',
    color: '#8b8fa3',
  },

  /* ─── History / Rewind ─── */
  historyButton: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    padding: '6px 8px',
    cursor: 'pointer',
    color: '#8b8fa3',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
  },

  historyButtonActive: {
    backgroundColor: 'rgba(108, 140, 255, 0.15)',
    borderColor: 'rgba(108, 140, 255, 0.4)',
    color: '#6c8cff',
  },

  historyPanel: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '420px',
    maxHeight: '80vh',
    backgroundColor: '#24272f',
    border: '1px solid #3d4150',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    zIndex: 100,
    boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
    overflow: 'hidden',
  },

  historyPanelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px 12px',
    borderBottom: '1px solid #2d3139',
    flexShrink: 0,
  },

  historyPanelHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },

  historyPanelTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#e8eaed',
  },

  historyPanelBody: {
    flex: 1,
    overflow: 'auto' as const,
    padding: '8px 0',
    minHeight: '120px',
    maxHeight: '50vh',
  },

  historyEmpty: {
    fontSize: '13px',
    color: '#8b8fa3',
    padding: '32px 20px',
    textAlign: 'center' as const,
    lineHeight: '1.5',
  },

  historyEntryTabCount: {
    fontSize: '11px',
    color: '#8b8fa3',
    backgroundColor: 'rgba(255,255,255,0.06)',
    padding: '2px 8px',
    borderRadius: '3px',
  },

  historyTab: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '7px 20px',
    overflow: 'hidden',
  },

  historyTabFavicon: {
    width: '18px',
    height: '18px',
    borderRadius: '3px',
    flexShrink: 0,
    objectFit: 'cover' as const,
  },

  historyTabFaviconPlaceholder: {
    width: '18px',
    height: '18px',
    borderRadius: '3px',
    backgroundColor: '#3d4150',
    flexShrink: 0,
  },

  historyTabTitle: {
    fontSize: '13px',
    color: '#e8eaed',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },

  historyNavBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    padding: '10px 20px',
    borderTop: '1px solid #2d3139',
    backgroundColor: 'rgba(108, 140, 255, 0.06)',
    flexShrink: 0,
  },

  historyNavButton: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: '#6c8cff',
    color: '#fff',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s',
    flexShrink: 0,
  },

  historyNavTime: {
    fontSize: '13px',
    color: '#e8eaed',
    fontWeight: 500,
    minWidth: '120px',
    textAlign: 'center' as const,
  },

  historyActionBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '12px 20px',
    borderTop: '1px solid #2d3139',
    flexShrink: 0,
  },

  historyCancelButton: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#8b8fa3',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '8px 16px',
    transition: 'all 0.15s',
  },

  historyRestoreButton: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: '#6c8cff',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 24px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },

  historyRestoreConfirm: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#fff',
    backgroundColor: '#f59e0b',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 20px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
};

export default NewTab;
