/**
 * Shared constants for the new-tab UI.
 * Extracted from NewTab.tsx during the 2026-04-15 split so that
 * styles.ts, WorkspaceSidebarItem.tsx, TabCard.tsx, and NewTab.tsx
 * can all reference them without circular imports.
 */

export const SIDEBAR_WIDTH = 220;

export const COLOR_PALETTE = [
  // Row 1 — Bold primaries & secondaries
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  // Row 2 — Rich mid-tones
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
  // Row 3 — Vivid accents
  '#f43f5e', '#fb923c', '#84cc16', '#14b8a6', '#0ea5e9',
  // Row 4 — Deep & muted
  '#7c3aed', '#db2777', '#b91c1c', '#047857', '#1e40af',
];

/** Format bytes into a human-readable string (KB, MB, GB). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
