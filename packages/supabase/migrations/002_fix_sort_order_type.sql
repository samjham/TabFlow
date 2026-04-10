-- Fix sort_order columns to support larger values.
-- The integer type (max ~2.1 billion) overflows when Date.now() timestamps
-- are accidentally stored. bigint handles any value safely.

ALTER TABLE public.workspaces ALTER COLUMN sort_order TYPE bigint;
ALTER TABLE public.tabs ALTER COLUMN sort_order TYPE bigint;
