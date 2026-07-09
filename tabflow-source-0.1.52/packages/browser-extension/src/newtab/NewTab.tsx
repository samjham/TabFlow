/**
 * New Tab Page Component for TabFlow
 *
 * Displays a full-screen workspace manager with:
 * - Left sidebar showing workspaces and user info
 * - Main content area showing tabs in the active workspace
 * - Collapsible sidebar with smooth interactions
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWorkspaces, SearchResult } from './useWorkspaces';
import type { WorkspaceHistoryEntry, DeletedWorkspace } from '@tabflow/core';
import * as AuthManager from '../auth/AuthManager';
import type { Tab } from '@tabflow/core';
import { SIDEBAR_WIDTH, COLOR_PALETTE, formatBytes } from './constants';
import { styles } from './styles';
import { WorkspaceSidebarItem } from './WorkspaceSidebarItem';
import { TabCard } from './TabCard';
import { HistoryPanel } from './HistoryPanel';
import { ArchivePanel } from './ArchivePanel';
import { isFirefox } from '../browser-compat';

interface DiagnosticEntry {
  ts: number;
  category: string;
  message: string;
  data?: string;
}

/**
 * TabFlow version pulled from the manifest at module load.
 * Rendered in the top-right header alongside memory stats.
 */
const TABFLOW_VERSION = chrome.runtime.getManifest().version;

/**
 * Display label for the current browser. Used in the memory line so it
 * reads "Chrome X/Y" or "Firefox X/Y" depending on the build target.
 */
const BROWSER_LABEL = isFirefox ? 'Firefox' : 'Chrome';

interface NewTabProps {
  user?: { id: string; email: string } | null;
  onSignOut?: () => void;
}

export const NewTab: React.FC<NewTabProps> = ({ user, onSignOut }) => {
  const { workspaces, activeWorkspace, tabs, loading, error, createWorkspace, deleteWorkspace, switchWorkspace, renameWorkspace, changeWorkspaceColor, changeShortName, reorderWorkspaces, removeTab, removeTabs, moveTabs, duplicateTabs, closeAllTabs, getWorkspaceHistory, restoreHistoryEntry, searchAllWorkspaces, reorderTabs, toggleTabPersistent, getDeletedWorkspaces, restoreDeletedWorkspaces, permanentlyDeleteWorkspaces } = useWorkspaces();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Persisted, user-controlled sidebar width (defaults to SIDEBAR_WIDTH).
  // The drag handle on the right edge updates this and writes it to
  // chrome.storage.local so it survives across sessions. A future change
  // will mirror this through user_settings.preferences so the value also
  // syncs across devices.
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_WIDTH);
  // True while the user is mid-drag on the resize handle — disables CSS
  // transitions so width changes track the cursor instantly.
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  // True when an item in the sidebar reports its label is currently being
  // clamped and wants the sidebar widened to reveal it. Only the truncated
  // hover triggers this — see WorkspaceSidebarItem onWantsHoverExpand.
  const [hoverExpandActive, setHoverExpandActive] = useState(false);
  // Ref for the debounced collapse timer. When the cursor leaves a workspace
  // item, we schedule a collapse 200ms later. If another item's hover
  // re-fires within that window (e.g. because the CSS transition caused a
  // phantom mouseleave/mouseenter pair as items reflowed), we cancel the
  // pending collapse and stay expanded. Without this, the sidebar bounces
  // between expanded and collapsed for a few hundred ms whenever expand
  // first fires.
  const hoverCollapseTimerRef = useRef<number | null>(null);
  /** Width the sidebar expands to on truncated-name hover. */
  const HOVER_EXPAND_WIDTH = 380;
  /** Min and max bounds the user can drag to. */
  const SIDEBAR_MIN_WIDTH = 180;
  const SIDEBAR_MAX_WIDTH = 400;
  /** chrome.storage.local key for the persisted sidebar width. */
  const SIDEBAR_WIDTH_STORAGE_KEY = 'tabflow_sidebar_width';
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
  const [deletedWorkspaces, setDeletedWorkspaces] = useState<DeletedWorkspace[]>([]);
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<Set<string>>(new Set());
  const [archiveLoading, setArchiveLoading] = useState(false);

  // ─── Multi-device sync: "Resume Working Here" ───
  const [isActiveDevice, setIsActiveDevice] = useState<'unknown' | 'active' | 'inactive'>('unknown');
  const [pollHasReturned, setPollHasReturned] = useState(false);
  const [inactiveClaimedBy, setInactiveClaimedBy] = useState<string | null>(null);
  const [claimInProgress, setClaimInProgress] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  // 0.1.51: 4-second grace period after mount. If sync init confirms
  // 'active' within that window, the Resume modal never appears (avoids
  // flashing the modal on every SW restart while polling races init).
  const [mountedAt] = useState<number>(() => Date.now());
  const [graceExpired, setGraceExpired] = useState(false);

  // ─── Phase 3: floating loading overlay during system operations ───
  // Polled from the SystemOperationGate via GET_OPERATION_STATUS every 300ms.
  // When non-null, a small banner with a spinner appears at the top of the
  // page. The banner is pointer-events:none and doesn't block input or
  // media playback — purely informational.
  const [currentOperation, setCurrentOperation] = useState<{ name: string; startedAt: number } | null>(null);

  // 0.1.44: In-app diagnostic log viewer (Ctrl+Shift+D).
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [diagnosticEntries, setDiagnosticEntries] = useState<DiagnosticEntry[]>([]);

  // 0.1.45: One-click Diagnose button state.
  const [diagnoseToast, setDiagnoseToast] = useState<string | null>(null);
  const [diagnoseBusy, setDiagnoseBusy] = useState(false);
  const [diagnoseFallbackReport, setDiagnoseFallbackReport] = useState<string | null>(null);
  const [diagnoseButtonHover, setDiagnoseButtonHover] = useState(false);

  // ─── Passphrase mismatch safeguard ───
  // Set when the background service worker detected that the local passphrase
  // can't decrypt the cloud canary. Sync is halted until the user re-signs in
  // with the correct passphrase.
  const [passphraseMismatch, setPassphraseMismatch] = useState<string | null>(null);

  // 0.1.50: schema-cache-missing-column banner. When SupabaseSyncClient
  // hits a PostgREST error like "Could not find the 'X' column of 'tabs'
  // in the schema cache" (typically because the user hasn't re-run
  // tabflow-setup.sql after an upgrade that added a column), the SW
  // records the column name in chrome.storage.local. We poll every 5s
  // and show a prominent yellow banner with the exact ALTER TABLE SQL.
  const [schemaMissingColumn, setSchemaMissingColumn] = useState<
    { column: string; operation: string; detectedAt: number } | null
  >(null);
  const [schemaSqlCopied, setSchemaSqlCopied] = useState(false);
  const [schemaBannerDismissed, setSchemaBannerDismissed] = useState(false);

  // 0.1.50: read the schema-cache flag on mount + poll every 5s.
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      try {
        chrome.storage.local.get('tabflow_schema_missing_column', (result) => {
          if (cancelled) return;
          const flag = result?.tabflow_schema_missing_column;
          if (flag && typeof flag.column === 'string') {
            setSchemaMissingColumn({
              column: flag.column,
              operation: flag.operation || 'unknown',
              detectedAt: flag.detectedAt || 0,
            });
          } else {
            setSchemaMissingColumn(null);
            // Reset the session-dismiss when the flag is cleared so a
            // fresh occurrence re-shows the banner.
            setSchemaBannerDismissed(false);
          }
        });
      } catch {
        // ignore
      }
    };
    check();
    const id = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // 0.1.44: Ctrl+Shift+D toggles the diagnostic log panel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setDebugPanelOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // 0.1.44: Poll GET_DIAGNOSTIC_LOG every 2s while the debug panel is open.
  useEffect(() => {
    if (!debugPanelOpen) return;
    const fetchLog = () => {
      chrome.runtime.sendMessage({ type: 'GET_DIAGNOSTIC_LOG' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.success && Array.isArray(response.data)) {
          setDiagnosticEntries(response.data as DiagnosticEntry[]);
        }
      });
    };
    fetchLog();
    const timer = setInterval(fetchLog, 2000);
    return () => clearInterval(timer);
  }, [debugPanelOpen])

  // 0.1.45: Auto-dismiss the Copied toast after 2s.
  useEffect(() => {
    if (!diagnoseToast) return;
    const t = setTimeout(() => setDiagnoseToast(null), 2000);
    return () => clearTimeout(t);
  }, [diagnoseToast]);

  // 0.1.45: Diagnose button handler. Sends GET_DIAGNOSTIC_REPORT to the
  // service worker, copies the returned text to clipboard, shows a toast.
  // On any failure, falls back to a modal textarea the user can copy from.
  const handleDiagnose = () => {
    if (diagnoseBusy) return;
    setDiagnoseBusy(true);
    chrome.runtime.sendMessage({ type: 'GET_DIAGNOSTIC_REPORT' }, async (response) => {
      setDiagnoseBusy(false);
      if (chrome.runtime.lastError) {
        console.warn('[TabFlow] Diagnose message failed:', chrome.runtime.lastError.message);
        setDiagnoseToast('Failed to gather report - see console');
        return;
      }
      const report = response?.data?.report as string | undefined;
      if (!response?.success || typeof report !== 'string') {
        setDiagnoseToast('Failed to gather report - see console');
        return;
      }
      try {
        await navigator.clipboard.writeText(report);
        setDiagnoseToast('Copied diagnostic report to clipboard');
      } catch (err) {
        console.warn('[TabFlow] Clipboard write failed, showing fallback modal:', err);
        setDiagnoseFallbackReport(report);
      }
    });
  };

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

  // Load persisted sidebar width on mount.
  useEffect(() => {
    chrome.storage.local.get(SIDEBAR_WIDTH_STORAGE_KEY).then((stored) => {
      const w = stored[SIDEBAR_WIDTH_STORAGE_KEY];
      if (typeof w === 'number' && w >= SIDEBAR_MIN_WIDTH && w <= SIDEBAR_MAX_WIDTH) {
        setSidebarWidth(w);
      }
    }).catch(() => { /* storage unavailable — keep default */ });
    // Disable lint: SIDEBAR_* constants are stable per render and we only
    // want to load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Phase 3: inject @keyframes for the operation-overlay spinner ───
  // styles.ts CSSProperties can't define keyframes (those are top-level CSS
  // rules), so we inject a tiny <style> tag once on mount and clean it up
  // on unmount. No-op if React strict-mode double-mounts in dev (the second
  // mount finds the existing rule, browsers tolerate duplicate keyframes).
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-tabflow-overlay', 'spinner');
    style.textContent = '@keyframes tabflow-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
    return () => {
      if (style.parentNode) style.parentNode.removeChild(style);
    };
  }, []);

  // ─── Phase 3: poll GET_OPERATION_STATUS every 300ms ───
  // Drives the floating loading overlay. The SystemOperationGate is set
  // for all five system operations (workspace switch, history restore,
  // claim materialization, move tabs, Chrome-restart flow); when active
  // the overlay surfaces a friendly label so the user knows something
  // is happening. 300ms is responsive enough that the overlay appears
  // within a frame of the click, and infrequent enough not to add SW
  // latency.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const POLL_MS = 300;
    const poll = () => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_OPERATION_STATUS' }, (response) => {
          if (cancelled) return;
          if (chrome.runtime.lastError) {
            // SW is restarting / not ready — try again next tick.
            timer = window.setTimeout(poll, POLL_MS);
            return;
          }
          if (response?.success) {
            const state = response.data as { operationName: string; startedAt: number } | null;
            if (state) {
              setCurrentOperation((prev) => {
                if (prev && prev.name === state.operationName && prev.startedAt === state.startedAt) {
                  return prev;
                }
                return { name: state.operationName, startedAt: state.startedAt };
              });
            } else {
              setCurrentOperation((prev) => (prev === null ? prev : null));
            }
          }
          if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
        });
      } catch {
        if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);


  // Resize drag — wire global mousemove/mouseup while dragging the
  // sidebar's right-edge handle. Window-level so the drag continues
  // even when the cursor leaves the sidebar's pixel area.
  useEffect(() => {
    if (!isResizingSidebar) return;
    const handleMove = (e: MouseEvent) => {
      const clamped = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, e.clientX)
      );
      setSidebarWidth(clamped);
    };
    const handleUp = () => {
      setIsResizingSidebar(false);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizingSidebar]);

  // Persist the user-chosen sidebar width to chrome.storage.local
  // whenever the drag finishes (i.e. when isResizingSidebar flips false).
  useEffect(() => {
    if (isResizingSidebar) return;
    chrome.storage.local.set({ [SIDEBAR_WIDTH_STORAGE_KEY]: sidebarWidth })
      .catch(() => { /* storage unavailable — non-fatal */ });
    // Also push to the service worker so the value mirrors to the cloud
    // and reaches the user's other devices on their next claim/pull.
    try {
      chrome.runtime.sendMessage({ type: 'SAVE_SIDEBAR_WIDTH', payload: { width: sidebarWidth } });
    } catch { /* SW unreachable — non-fatal */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isResizingSidebar, sidebarWidth]);

  // Clear selection when switching workspaces
  useEffect(() => {
    setSelectedTabIds(new Set());
    setShowMovePopup(false);
    setShowCloseAllConfirm(false);
    setShowDeleteSelectedConfirm(false);
    setShowDuplicatePopup(false);
  }, [activeWorkspace?.id]);

  // Fetch thumbnails for current workspace tabs.
  //
  // 0.1.31: poll FAST (every 1s) for the first 30s after the active
  // workspace changes, then settle to every 5s. The fast phase catches
  // newly-captured thumbnails from the bulk backfill pass that runs
  // ~1s after a switch — they would otherwise take up to 5s to appear.
  // The slow phase covers steady-state usage (user clicks a tab, a
  // single capture happens, refresh within 5s).
  useEffect(() => {
    if (!tabs || tabs.length === 0) return;
    const tabIds = tabs.map((t) => t.id).filter(Boolean);
    if (tabIds.length === 0) return;

    const fetchThumbnails = () => {
      chrome.runtime.sendMessage(
        { type: 'GET_THUMBNAILS', payload: { tabIds } },
        (response) => {
          if (response?.success && response.data) {
            setThumbnails((prev) => ({ ...prev, ...response.data }));
          }
        }
      );
    };

    // Fetch immediately
    fetchThumbnails();

    // Fast polling for the first 30s after this workspace becomes
    // active (catches backfill captures), then slow polling after.
    const fastStart = Date.now();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      const elapsed = Date.now() - fastStart;
      const delay = elapsed < 30000 ? 1000 : 5000;
      timer = setTimeout(() => {
        if (cancelled) return;
        fetchThumbnails();
        schedule();
      }, delay);
    };
    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [tabs, activeWorkspace?.id]);

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

  // ─── Multi-device status: recurring poll + listen for passphrase mismatch ───
  useEffect(() => {
    let timer: number | null = null;
    let cancelled = false;

    const POLL_INTERVAL_MS = 3000;

    const poll = () => {
      chrome.runtime.sendMessage({ type: 'GET_DEVICE_STATUS' }, (response) => {
        if (cancelled) return;
        if (response?.success && response.data) {
          setIsActiveDevice(response.data.isActive ? 'active' : 'inactive');
          setInactiveClaimedBy(response.data.claimedBy || null);
          setPollHasReturned(true);
        }
        // Schedule next poll regardless of success — the SW may be cold
        // starting on this call and respond properly on the next one.
        if (!cancelled) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS);
        }
      });
    };

    // Kick off the first poll immediately.
    poll();

    // Also poll immediately whenever the tab becomes visible again, so a
    // user returning to a PC after hours/days away gets fresh status within
    // milliseconds instead of waiting up to POLL_INTERVAL_MS. This is the
    // key fix for the "I sat down at PC2 after the weekend and the Resume
    // Working Here modal didn't show" symptom — Firefox suspends idle tab
    // timers, so on focus we force a fresh check.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        if (timer !== null) {
          window.clearTimeout(timer);
          timer = null;
        }
        poll();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    // Check initial passphrase-mismatch state (may have been set before this
    // page loaded).
    chrome.storage.session.get('passphraseMismatch').then((stored) => {
      if (stored?.passphraseMismatch?.message) {
        setPassphraseMismatch(stored.passphraseMismatch.message);
      }
    }).catch(() => {});

    // Listen for passphrase-mismatch state changes via storage.session.
    // (The old `deviceStatus` broadcast was removed in the 2026-04-20
    // DB-only refactor and is no longer written by the service worker;
    // polling above replaces it. We keep passphraseMismatch listening
    // because that IS still broadcast via storage.session.)
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName !== 'session') return;
      if (changes.passphraseMismatch) {
        const mismatch = changes.passphraseMismatch.newValue;
        setPassphraseMismatch(mismatch?.message || null);
      }
    };
    chrome.storage.onChanged.addListener(listener);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  // Safety: if the polling hasn't returned a definitive answer in 5s,
  // show the modal anyway. Better to ask the user to act than to silently
  // leave them in a half-initialized state where enforceTabLock still
  // fires but the modal never appeared.
  useEffect(() => {
    const safetyTimer = window.setTimeout(() => {
      setIsActiveDevice((prev) => (prev === 'unknown' ? 'inactive' : prev));
    }, 5000);
    return () => window.clearTimeout(safetyTimer);
  }, []);

  // 0.1.39: clear any stale claim error when the device transitions to
  // active. Covers two cases:
  //   (1) The user's first Resume click hit the "Sync not initialized"
  //       race and set an error; their second click succeeded but the
  //       success path only clears claimError in the response callback,
  //       not via a side-channel like realtime/polling.
  //   (2) A different mechanism (e.g. another tab in the same browser
  //       successfully claimed) flips isActiveDevice to 'active' while
  //       this tab's modal still has a stale error.
  useEffect(() => {
    if (isActiveDevice === 'active') {
      setClaimError(null);
    }
  }, [isActiveDevice]);

  // 0.1.51: fire graceExpired after 8s if isActiveDevice is still
  // 'unknown'. If sync confirms 'active' earlier the modal never renders;
  // if it's still 'unknown' after 8s we surface the modal so the user
  // isn't blocked from taking over when sync init is genuinely broken.
  // 0.1.52: bumped from 4s to 8s to accommodate slower sync init on cold
  // starts (Firefox in particular can take longer to complete auth).
  useEffect(() => {
    if (isActiveDevice === 'unknown') {
      const timer = setTimeout(() => {
        setGraceExpired(true);
      }, 8000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isActiveDevice, mountedAt]);

  /** Handler for "Resume Working Here" button */
  const handleResumeHere = useCallback(() => {
    setClaimInProgress(true);
    setClaimError(null);
    chrome.runtime.sendMessage(
      { type: 'CLAIM_ACTIVE_DEVICE' },
      (response) => {
        setClaimInProgress(false);
        if (response?.success) {
          setIsActiveDevice('active');
          setInactiveClaimedBy(null);
          setClaimError(null);
        } else {
          setClaimError(response?.error || 'Failed to resume here. Please try again.');
        }
      }
    );
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

  const handleOpenTab = async (tab: Tab) => {
    // Storage tab IDs are deterministic hashes (`tab-<16hex>`) since the
    // cross-browser ID migration — they no longer carry the Chrome numeric
    // tab ID, so we can't use `chrome.tabs.update(id)` directly. Instead we
    // ask the background worker to find a live Chrome tab with a matching
    // URL and activate it; only if none exists do we open a new one.
    const found = await activateTabByUrl(tab.url);
    if (found) return;
    chrome.tabs.create({ url: tab.url, active: true });
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
          width: sidebarOpen
            ? (hoverExpandActive ? Math.max(sidebarWidth, HOVER_EXPAND_WIDTH) : sidebarWidth)
            : 0,
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? 'auto' : 'none',
          transition: isResizingSidebar ? 'none' : 'all 0.2s ease-out',
        }}
        onMouseEnter={() => {
          // Cancel any pending collapse — sidebar is still hovered.
          if (hoverCollapseTimerRef.current !== null) {
            window.clearTimeout(hoverCollapseTimerRef.current);
            hoverCollapseTimerRef.current = null;
          }
        }}
        onMouseLeave={() => {
          // Cursor left the entire sidebar — collapse after a small
          // debounce to absorb CSS-transition phantom events. This is
          // the only place hover-expand collapse fires from. Item-level
          // mouseleave no longer collapses; see onWantsHoverCollapse above.
          if (hoverCollapseTimerRef.current !== null) {
            window.clearTimeout(hoverCollapseTimerRef.current);
          }
          hoverCollapseTimerRef.current = window.setTimeout(() => {
            setHoverExpandActive(false);
            hoverCollapseTimerRef.current = null;
          }, 100);
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
                disabled={currentOperation !== null}
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
                onWantsHoverExpand={() => {
                  if (hoverCollapseTimerRef.current !== null) {
                    window.clearTimeout(hoverCollapseTimerRef.current);
                    hoverCollapseTimerRef.current = null;
                  }
                  setHoverExpandActive(true);
                }}
                onWantsHoverCollapse={() => {
                  // No-op: item-level mouseleave used to collapse, but that
                  // caused a bounce loop when expand reflowed the name and
                  // the cursor ended up in empty space outside the item.
                  // Collapse is now triggered at the sidebar level — see
                  // the sidebar div's onMouseLeave handler below.
                }}
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
            <ArchivePanel
              loading={archiveLoading}
              deletedWorkspaces={deletedWorkspaces}
              selectedIds={selectedArchiveIds}
              onToggleSelection={handleToggleArchiveSelection}
              onRestore={handleRestoreSelected}
              onPermanentlyDelete={handlePermanentlyDeleteSelected}
            />
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
          left: sidebarOpen ? (hoverExpandActive ? Math.max(sidebarWidth, HOVER_EXPAND_WIDTH) : sidebarWidth) - 12 : 0,
        }}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title={sidebarOpen ? 'Collapse' : 'Expand'}
      >
        {sidebarOpen ? '‹' : '›'}
      </button>

      {/* Sidebar drag-resize handle. Thin vertical strip sitting on the
          sidebar's right edge — cursor changes to ew-resize, mousedown
          starts the drag (handled globally via the useEffect above). */}
      {sidebarOpen && (
        <div
          onMouseDown={(e) => { e.preventDefault(); setIsResizingSidebar(true); }}
          style={{
            position: 'absolute',
            left: (hoverExpandActive ? Math.max(sidebarWidth, HOVER_EXPAND_WIDTH) : sidebarWidth) - 2,
            top: 0,
            bottom: 0,
            width: '4px',
            cursor: 'ew-resize',
            zIndex: 50,
            transition: isResizingSidebar ? 'none' : 'left 0.2s ease-out',
          }}
          title="Drag to resize sidebar"
        />
      )}

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

        {/* 0.1.50: schema-cache-missing-column banner. Fires when Supabase
            rejects a push because a column is missing from PostgREST's
            schema cache — typically because the user hasn't re-run the
            tabflow-setup.sql after an upgrade that added a column.
            Shows the exact ALTER TABLE + NOTIFY reload SQL. Not
            dismissible-forever — the session-level dismiss clears when
            a fresh occurrence is detected. */}
        {schemaMissingColumn && !schemaBannerDismissed && (() => {
          const col = schemaMissingColumn.column;
          const knownColumn = col === 'persistent';
          const sql = knownColumn
            ? `ALTER TABLE public.tabs ADD COLUMN IF NOT EXISTS ${col} BOOLEAN NOT NULL DEFAULT false;\nNOTIFY pgrst, 'reload schema';`
            : `-- Re-run packages/supabase/tabflow-setup.sql on your Supabase project.\n-- The missing column is: ${col}\n-- Check the setup SQL file for the correct column type.\nNOTIFY pgrst, 'reload schema';`;
          return (
            <div style={styles.schemaBanner}>
              <div style={styles.schemaBannerContent}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                  <path d="M12 2L1 21h22L12 2zm0 4.83L19.17 19H4.83L12 6.83zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" fill="#78350f"/>
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={styles.schemaBannerTitle}>
                    Your Supabase schema is missing a column
                    (&lsquo;{col}&rsquo;). Sync is failing.
                  </div>
                  <div style={styles.schemaBannerBody}>
                    Run this SQL in your Supabase dashboard (SQL Editor):
                  </div>
                  <pre style={styles.schemaBannerCode}>{sql}</pre>
                  <div style={styles.schemaBannerActions}>
                    <button
                      style={styles.schemaBannerBtn}
                      onClick={() => {
                        try {
                          navigator.clipboard.writeText(sql);
                          setSchemaSqlCopied(true);
                          setTimeout(() => setSchemaSqlCopied(false), 2000);
                        } catch {
                          /* ignore */
                        }
                      }}
                    >
                      {schemaSqlCopied ? 'Copied!' : 'Copy SQL'}
                    </button>
                    <button
                      style={styles.schemaBannerBtnSecondary}
                      onClick={() => setSchemaBannerDismissed(true)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Resume Working Here modal (inactive device) — blocks interaction
            with the rest of the page until the user claims or closes the tab.
            Using a full-viewport overlay rather than a banner because the
            cross-browser-sync claim is destructive (replaces this browser's
            tabs with the active workspace's tabs) and the user needs to
            make an informed choice about what to do with the current tabs. */}
        {(isActiveDevice === 'inactive' || (isActiveDevice === 'unknown' && graceExpired)) && (
          <div style={styles.resumeModalBackdrop}>
            <div style={styles.resumeModal}>
              <div style={styles.resumeModalAccent} />
              <h2 style={styles.resumeModalTitle}>Resume Working Here</h2>
              <p style={styles.resumeModalSubtitle}>
                {inactiveClaimedBy
                  ? `Last used on: ${inactiveClaimedBy}`
                  : 'Your workspaces were last used on another device.'}
              </p>
              <p style={styles.resumeModalBody}>
                This will pull your latest workspaces and tabs from the cloud
                and set up this browser to match.
              </p>

              {claimError && !claimInProgress && isActiveDevice !== 'active' && (
                <div style={styles.resumeModalError}>{claimError}</div>
              )}

              <div style={styles.resumeModalActions}>
                <button
                  style={styles.resumeModalPrimary}
                  onClick={handleResumeHere}
                  disabled={claimInProgress}
                >
                  {claimInProgress ? 'Resuming…' : 'Resume Working Here'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 0.1.34: blocking centered modal during system operations.
            Replaces the prior pointer-events:none top banner. The modal
            blocks clicks because the operation is in progress — notably
            during the thumbnail backfill that now runs inside the
            workspace switch (so user clicks can't race tab activations).
            YouTube videos in OTHER tabs keep playing; the modal lives on
            the TabFlow newtab page only. Visibility is driven by
            `currentOperation` which is polled every 300ms from the
            SystemOperationGate. */}
        {currentOperation && (
          <div style={styles.operationOverlay} aria-live="polite" aria-busy="true" role="dialog" aria-modal="true">
            <div style={styles.operationModalCard}>
              <div style={styles.operationModalAccent} />
              <div style={styles.operationOverlaySpinner} />
              <h2 style={styles.operationModalTitle}>
                {currentOperation.name === 'handleSwitchWorkspace'
                  ? 'Switching workspace\u2026'
                  : currentOperation.name === 'handleRestoreHistoryEntry'
                  ? 'Restoring from history\u2026'
                  : currentOperation.name === 'claimActiveDeviceWithMaterialization'
                  ? 'Loading from cloud\u2026'
                  : currentOperation.name === 'handleMoveTabsInServiceWorker'
                  ? 'Moving tabs\u2026'
                  : currentOperation.name === 'startupReconcile'
                  ? 'Restoring session\u2026'
                  : 'Working\u2026'}
              </h2>
              <p style={styles.operationModalSubtitle}>
                {'Please wait \u2014 TabFlow is updating your tabs.'}
              </p>
            </div>
          </div>
        )}

        {/* 0.1.44: In-app diagnostic log viewer. Toggled with Ctrl+Shift+D.
            Reads the rolling logDiagnostic() buffer from chrome.storage.local
            every 2 seconds and displays it in a monospaced textarea for
            copy-paste into bug reports. z-index is lower than the operation
            overlay (10000) and Resume modal (9999) so those still block
            interaction if they're up. */}
        {/* 0.1.45: One-click Diagnose toast. Shown briefly after a
            successful copy-to-clipboard. Non-blocking. */}
        {diagnoseToast && (
          <div style={styles.diagnoseToast} role="status" aria-live="polite">
            {diagnoseToast}
          </div>
        )}

        {/* 0.1.45: Clipboard-fallback modal for the Diagnose button.
            Shown only when the report was gathered but navigator.clipboard
            failed (e.g. permissions). The user can select-all + copy from
            the textarea. */}
        {diagnoseFallbackReport !== null && (
          <div style={styles.diagnoseFallbackBackdrop} role="dialog" aria-modal="true" aria-label="Diagnostic report">
            <div style={styles.diagnoseFallbackCard}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <strong>Diagnostic Report</strong>
                <span style={{ fontSize: '11px', color: '#8b93a8' }}>Copy failed - select all + copy manually</span>
              </div>
              <textarea
                readOnly
                style={styles.diagnoseFallbackTextarea}
                value={diagnoseFallbackReport}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  style={styles.debugPanelButton}
                  onClick={() => setDiagnoseFallbackReport(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {debugPanelOpen && (
          <div style={styles.debugPanelBackdrop} role="dialog" aria-modal="true" aria-label="Diagnostic log">
            <div style={styles.debugPanelCard}>
              <div style={styles.debugPanelHeader}>
                <span>TabFlow Diagnostic Log ({diagnosticEntries.length} entries)</span>
                <span style={{ fontSize: '11px', color: '#8b93a8', fontWeight: 400 }}>Ctrl+Shift+D to close</span>
              </div>
              <textarea
                readOnly
                style={styles.debugPanelTextarea}
                value={diagnosticEntries
                  .map((e) => {
                    const t = new Date(e.ts).toISOString().replace('T', ' ').replace('Z', '');
                    return e.data !== undefined
                      ? `${t} [${e.category}] ${e.message} ${e.data}`
                      : `${t} [${e.category}] ${e.message}`;
                  })
                  .join('\n')}
              />
              <div style={styles.debugPanelActions}>
                <button
                  style={styles.debugPanelButton}
                  onClick={() => {
                    const text = diagnosticEntries
                      .map((e) => {
                        const t = new Date(e.ts).toISOString().replace('T', ' ').replace('Z', '');
                        return e.data !== undefined
                          ? `${t} [${e.category}] ${e.message} ${e.data}`
                          : `${t} [${e.category}] ${e.message}`;
                      })
                      .join('\n');
                    navigator.clipboard.writeText(text).catch(() => {});
                  }}
                >
                  Copy to Clipboard
                </button>
                <button
                  style={styles.debugPanelButton}
                  onClick={() => {
                    chrome.runtime.sendMessage({ type: 'CLEAR_DIAGNOSTIC_LOG' }, () => {
                      setDiagnosticEntries([]);
                    });
                  }}
                >
                  Clear Log
                </button>
                <button style={styles.debugPanelButton} onClick={() => setDebugPanelOpen(false)}>
                  Close
                </button>
              </div>
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
              <div style={styles.memoryBlock}>
                {systemMemory.total > 0 && (
                  <span style={styles.memoryLine}>System {formatBytes(systemMemory.total - systemMemory.available)}/{formatBytes(systemMemory.total)}</span>
                )}
                {chromeMemory > 0 && systemMemory.total > 0 && (
                  <span style={styles.memoryLine}>{BROWSER_LABEL} {formatBytes(chromeMemory)}/{formatBytes(systemMemory.total - systemMemory.available)}</span>
                )}
                <span style={styles.memoryLine}>TabFlow v{TABFLOW_VERSION}</span>
              </div>
              <button
                type="button"
                title="Copy a diagnostic report to the clipboard for bug reports"
                onClick={handleDiagnose}
                onMouseEnter={() => setDiagnoseButtonHover(true)}
                onMouseLeave={() => setDiagnoseButtonHover(false)}
                disabled={diagnoseBusy}
                style={{
                  ...styles.diagnoseButton,
                  ...(diagnoseButtonHover ? styles.diagnoseButtonHover : {}),
                  ...(diagnoseBusy ? { opacity: 0.6, cursor: 'progress' } : {}),
                }}
              >
                {diagnoseBusy ? 'Gathering...' : 'Diagnose'}
              </button>
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
          <HistoryPanel
            ref={historyPanelRef}
            loading={historyLoading}
            entries={historyEntries}
            index={historyIndex}
            setIndex={setHistoryIndex}
            confirmRestore={confirmRestore}
            setConfirmRestore={setConfirmRestore}
            restoring={restoringHistory}
            onRestore={handleRestoreHistoryEntry}
            onClose={closeHistoryPanel}
          />
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
                      thumbnailUrl={thumbnails[tab.id]}
                      onToggleSelect={() => toggleTabSelection(tab.id)}
                      onClick={() => { if (!didDragRef.current) handleOpenTab(tab); }}
                      onRemove={() => handleRemoveTab(tab.id)}
                      onTogglePersistent={(id, next) => {
                        // Optimistic — hook updates its own local tabs; fire and forget
                        void toggleTabPersistent(id, next).catch(() => {});
                      }}
                    />
                  </div>
                ))}
              </div>

              {/* Floating drag tile — follows the cursor */}
              {dragTabId && dragPos && (() => {
                const draggedTab = localTabs.find((t) => t.id === dragTabId);
                const state = dragRef.current;
                if (!draggedTab || !state) return null;
                const dragAccent = activeWorkspace?.color || '#6c8cff';
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
                      // Soft halo in the workspace accent color (no spread,
                      // all blur) so the glow reads as a continuation of the
                      // pressed state rather than shifting hue at drag start.
                      boxShadow: [
                        `0 0 15px 0px ${dragAccent}80`,
                        `0 0 35px 0px ${dragAccent}4d`,
                        `0 0 35px 0px ${dragAccent}4d`,
                        `0 0 70px 0px ${dragAccent}26`,
                        '0 10px 30px 0px rgba(0, 0, 0, 0.4)',
                      ].join(', '),
                      borderRadius: '8px',
                    }}
                  >
                    <TabCard
                      tab={draggedTab}
                      accentColor={activeWorkspace?.color || '#6c8cff'}
                      selected={selectedTabIds.has(draggedTab.id)}
                      thumbnailUrl={thumbnails[draggedTab.id]}
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

export default NewTab;
