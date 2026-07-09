/**
 * History Rewind Panel
 *
 * Slide-in panel that lets the user scrub through per-workspace tab
 * snapshots and restore an older state. Each snapshot is a point-in-time
 * capture of the workspace's tabs (URL + title + favicon), deduplicated.
 *
 * Purely presentational — the actual snapshot fetching, index state,
 * and restore call live in the parent (NewTab.tsx).
 *
 * Extracted from NewTab.tsx on 2026-04-15 as part of the component split
 * follow-up. Root ref is forwarded so the parent can still attach refs
 * (currently unused but preserves the original DOM wiring).
 */

import React, { forwardRef } from 'react';
import type { WorkspaceHistoryEntry } from '@tabflow/core';
import { styles } from './styles';

/** Human-friendly relative time label. Pure — moved in from NewTab.tsx. */
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

export interface HistoryPanelProps {
  loading: boolean;
  entries: WorkspaceHistoryEntry[];
  index: number;
  setIndex: React.Dispatch<React.SetStateAction<number>>;
  confirmRestore: boolean;
  setConfirmRestore: React.Dispatch<React.SetStateAction<boolean>>;
  restoring: boolean;
  onRestore: () => void;
  onClose: () => void;
}

export const HistoryPanel = forwardRef<HTMLDivElement, HistoryPanelProps>(
  ({ loading, entries, index, setIndex, confirmRestore, setConfirmRestore, restoring, onRestore, onClose }, ref) => {
    return (
      <div ref={ref} style={styles.historyPanel}>
        {loading && (
          <div style={styles.historyEmpty}>Loading history...</div>
        )}
        {!loading && entries.length === 0 && (
          <div style={styles.historyEmpty}>
            No history yet. Snapshots are saved automatically as you browse.
          </div>
        )}
        {!loading && entries.length > 0 && (() => {
          const entry = entries[index];
          if (!entry) return null;
          const timeLabel = formatTimeAgo(new Date(entry.timestamp));
          const canRewind = index < entries.length - 1;
          const canForward = index > 0;

          return (
            <>
              {/* Header */}
              <div style={styles.historyPanelHeader}>
                <span style={styles.historyPanelTitle}>Previously open</span>
                <div style={styles.historyPanelHeaderRight}>
                  <span style={styles.historyEntryTabCount}>
                    {index + 1} / {entries.length}
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
                  onClick={() => { setIndex((i) => i + 1); setConfirmRestore(false); }}
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
                  onClick={() => { setIndex((i) => i - 1); setConfirmRestore(false); }}
                  title="Newer"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M9 3L14 8L9 13V3ZM2 3L7 8L2 13V3Z"/></svg>
                </button>
              </div>

              {/* Action bar: cancel / restore */}
              <div style={styles.historyActionBar}>
                {!confirmRestore ? (
                  <>
                    <button style={styles.historyCancelButton} onClick={onClose}>
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
                      disabled={restoring}
                      onClick={onRestore}
                    >
                      {restoring ? 'Restoring...' : 'Yes, restore'}
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
    );
  }
);

HistoryPanel.displayName = 'HistoryPanel';
