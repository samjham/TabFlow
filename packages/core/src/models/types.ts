/**
 * Core TypeScript types and interfaces for the TabFlow workspace and tab management system.
 * Defines the data models used throughout the application.
 */

/**
 * Represents a user in the system.
 */
export interface User {
  /** Unique identifier for the user */
  id: string;
  /** User's email address */
  email: string;
  /** Display name for the user */
  displayName: string;
  /** Timestamp when the user account was created */
  createdAt: Date;
}

/**
 * Represents a workspace - a container for related browser tabs.
 */
export interface Workspace {
  /** Unique identifier for the workspace */
  id: string;
  /** ID of the user who owns this workspace */
  userId: string;
  /** Human-readable name for the workspace */
  name: string;
  /** Optional color identifier or hex code for UI representation */
  color?: string;
  /** Optional icon identifier or emoji for the workspace */
  icon?: string;
  /** Optional 1-3 character label shown on the pinned tab favicon (e.g. "YT" for YouTube) */
  shortName?: string;
  /** Sort order for displaying multiple workspaces */
  sortOrder: number;
  /** Whether this is the currently active workspace */
  isActive: boolean;
  /** Timestamp of the last update to this workspace */
  updatedAt: Date;
  /** Version number for optimistic concurrency control */
  version: number;
}

/**
 * Represents a browser tab within a workspace.
 */
export interface Tab {
  /** Unique identifier for the tab */
  id: string;
  /** ID of the workspace this tab belongs to */
  workspaceId: string;
  /** Full URL of the tab */
  url: string;
  /** Page title or user-defined name for the tab */
  title: string;
  /** Optional URL to the favicon of the web page */
  faviconUrl?: string;
  /** Sort order for displaying tabs within a workspace */
  sortOrder: number;
  /** Whether this tab is pinned to always show */
  isPinned: boolean;
  /** Timestamp of the last time this tab was accessed */
  lastAccessed: Date;
  /** Timestamp of the last update to this tab */
  updatedAt: Date;
}

/**
 * Represents a saved session snapshot of workspaces and their tabs.
 * Enables users to save and restore their entire workspace state.
 */
export interface Session {
  /** Unique identifier for the session */
  id: string;
  /** ID of the user who created this session */
  userId: string;
  /** User-defined name for this session snapshot */
  name: string;
  /** Complete snapshot of all workspaces and tabs at the time of creation */
  snapshot: WorkspaceSnapshot[];
  /** Timestamp when the session was created */
  createdAt: Date;
}

/**
 * A snapshot of a workspace and all its tabs at a point in time.
 * Used for session persistence and restoration.
 */
export interface WorkspaceSnapshot {
  /** The workspace data at the time of snapshot */
  workspace: Workspace;
  /** All tabs in this workspace at the time of snapshot */
  tabs: Tab[];
}

/**
 * A point-in-time snapshot of a workspace's tabs, used for history/rewind.
 * Saved on every meaningful change (tab opened, closed, navigated) but
 * deduplicated — only stored when the set of URLs actually changes.
 */
export interface WorkspaceHistoryEntry {
  /** Unique identifier for this history entry */
  id: string;
  /** The workspace this snapshot belongs to */
  workspaceId: string;
  /** When this snapshot was taken */
  timestamp: Date;
  /** The tab data at this point in time (URL, title, favicon, sort order) */
  tabs: Array<{
    url: string;
    title: string;
    faviconUrl?: string;
    sortOrder: number;
    isPinned: boolean;
  }>;
}

/**
 * Represents a sync event for real-time collaboration and persistence.
 * Describes changes to be synchronized across clients or stored remotely.
 */
export interface SyncEvent {
  /** The type of operation being performed */
  type: 'insert' | 'update' | 'delete';
  /** The database table this event relates to */
  table: 'workspaces' | 'tabs';
  /** The actual record data or affected record */
  record: any;
  /** Timestamp when the event was created */
  timestamp: Date;
}
