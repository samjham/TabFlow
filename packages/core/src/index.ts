/**
 * @tabflow/core - Main entry point
 * Re-exports all public types, interfaces, and classes
 */

// Models and types
export type { User, Workspace, Tab, Session, WorkspaceSnapshot, WorkspaceHistoryEntry, SyncEvent } from './models/types';

// Storage
export type { StorageAdapter } from './storage/StorageAdapter';

// Workspace engine
export { WorkspaceEngine } from './workspace/WorkspaceEngine';

// Sync client
export { SyncClient } from './sync/SyncClient';

// Encryption (E2E crypto)
export {
  deriveKey,
  encrypt,
  decrypt,
  encryptTab,
  decryptTab,
  toBase64,
  fromBase64,
} from './crypto/encryption';
