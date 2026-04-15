/**
 * Styles for the new-tab UI.
 *
 * Extracted from NewTab.tsx on 2026-04-15. This file is pure data —
 * a map of named CSSProperties objects consumed by NewTab.tsx,
 * WorkspaceSidebarItem.tsx, and TabCard.tsx.
 *
 * NOTE: A few entries below use `paddingX` / `paddingY` / `marginX` /
 * `marginY`, which are NOT valid CSSProperties fields and are silently
 * dropped by React at runtime. They're pre-existing (from before this
 * split) and are preserved verbatim to avoid behavior changes; a
 * dedicated pass should replace them with `paddingLeft` + `paddingRight`
 * (etc.) later.
 */

import React from 'react';
import { SIDEBAR_WIDTH } from './constants';

export const styles: Record<string, React.CSSProperties> = {
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
  } as React.CSSProperties,

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
  } as React.CSSProperties,

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
