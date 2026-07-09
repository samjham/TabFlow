/**
 * Archive Panel (recycle bin)
 *
 * Rendered inside the sidebar when the "Archive" section is expanded.
 * Shows a checkbox list of deleted workspaces with Restore and
 * permanently-Delete actions. The underlying storage is the
 * `deletedWorkspaces` Dexie v4 table with 90-day retention.
 *
 * Purely presentational — all the fetching, restore, and permanent-delete
 * operations live in the parent (NewTab.tsx).
 *
 * Extracted from NewTab.tsx on 2026-04-15 as part of the component split
 * follow-up.
 */

import React from 'react';
import type { DeletedWorkspace } from '@tabflow/core';

export interface ArchivePanelProps {
  loading: boolean;
  deletedWorkspaces: DeletedWorkspace[];
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onRestore: () => void;
  onPermanentlyDelete: () => void;
}

export const ArchivePanel: React.FC<ArchivePanelProps> = ({
  loading,
  deletedWorkspaces,
  selectedIds,
  onToggleSelection,
  onRestore,
  onPermanentlyDelete,
}) => {
  return (
    <div style={{ padding: '0 12px 8px' }}>
      {loading ? (
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
                  backgroundColor: selectedIds.has(dw.id) ? 'rgba(108, 140, 255, 0.15)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!selectedIds.has(dw.id)) {
                    (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = selectedIds.has(dw.id) ? 'rgba(108, 140, 255, 0.15)' : 'transparent';
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(dw.id)}
                  onChange={() => onToggleSelection(dw.id)}
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
          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                onClick={onRestore}
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
                Restore ({selectedIds.size})
              </button>
              <button
                onClick={onPermanentlyDelete}
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
  );
};
