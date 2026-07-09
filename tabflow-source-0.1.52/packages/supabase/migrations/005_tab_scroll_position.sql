-- Add scroll position columns to the tabs table.
-- These store the user's last known scroll offset so TabFlow can restore
-- the reading position when switching devices or workspaces.
ALTER TABLE public.tabs ADD COLUMN IF NOT EXISTS scroll_x integer DEFAULT 0;
ALTER TABLE public.tabs ADD COLUMN IF NOT EXISTS scroll_y integer DEFAULT 0;
