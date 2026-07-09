-- Migration 006: cross-device sync for workspace history, deleted workspaces,
-- and workspace shortName. Mirrors the same DDL that's also embedded in
-- packages/supabase/tabflow-setup.sql and SetupWizard's SETUP_SQL.
-- Idempotent — safe to re-run.

-- ── workspace_history ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  tab_snapshots jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_history_user_workspace_idx
  ON public.workspace_history(user_id, workspace_id, created_at DESC);

ALTER TABLE public.workspace_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS workspace_history_owner_all ON public.workspace_history;
END $$;

CREATE POLICY workspace_history_owner_all ON public.workspace_history
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_history TO service_role;

-- ── deleted_workspaces ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deleted_workspaces (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  workspace_data jsonb NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deleted_workspaces_user_idx
  ON public.deleted_workspaces(user_id, deleted_at DESC);

ALTER TABLE public.deleted_workspaces ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS deleted_workspaces_owner_all ON public.deleted_workspaces;
END $$;

CREATE POLICY deleted_workspaces_owner_all ON public.deleted_workspaces
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deleted_workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deleted_workspaces TO service_role;

-- ── workspaces.short_name ───────────────────────────────────────────────────
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS short_name text;
