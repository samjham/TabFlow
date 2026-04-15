/**
 * Workspace Sidebar Item
 *
 * Single row in the new-tab sidebar — renders the workspace's color dot,
 * name, tab count, audible indicator, and the right-click / ⋯ context menu
 * for renaming, color change, custom short-name, and delete.
 *
 * Extracted from NewTab.tsx on 2026-04-15 as part of the component split.
 * Props stayed identical to the original inline definition so NewTab.tsx
 * didn't need any call-site changes.
 */

import React, { useState } from 'react';
import { WorkspaceWithCount } from './useWorkspaces';
import { styles } from './styles';
import { COLOR_PALETTE } from './constants';

export interface WorkspaceSidebarItemProps {
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

export const WorkspaceSidebarItem: React.FC<WorkspaceSidebarItemProps> = ({
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
