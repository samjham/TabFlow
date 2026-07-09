-- ============================================================================
-- TabFlow — Complete Database Setup
-- ============================================================================
-- Paste this entire script into the Supabase SQL Editor and click "Run".
-- It creates all the tables, indexes, security policies, and real-time
-- subscriptions that TabFlow needs. Safe to run multiple times.
-- ============================================================================

-- ── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  encryption_salt text NOT NULL,
  canary text,                        -- encrypted known plaintext for passphrase verification
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS canary text;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  icon text,
  sort_order bigint NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tabs (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL,
  favicon_url text,
  sort_order bigint NOT NULL DEFAULT 0,
  is_pinned boolean NOT NULL DEFAULT false,
  last_accessed timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  scroll_x integer DEFAULT 0,
  scroll_y integer DEFAULT 0,
  persistent boolean NOT NULL DEFAULT false
);
-- For existing installs that already have the tabs table:
ALTER TABLE public.tabs ADD COLUMN IF NOT EXISTS scroll_x integer DEFAULT 0;
ALTER TABLE public.tabs ADD COLUMN IF NOT EXISTS scroll_y integer DEFAULT 0;
-- 0.1.46: user-controlled tab preservation across workspace switches (Firefox-only,
-- but stored in the shared schema so cross-device sync works). Default false so
-- existing rows keep old behaviour (close on switch).
ALTER TABLE public.tabs ADD COLUMN IF NOT EXISTS persistent boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.active_devices (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_name text NOT NULL DEFAULT 'Unknown Device',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON public.workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_is_active ON public.workspaces(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tabs_workspace_id ON public.tabs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tabs_user_id ON public.tabs(user_id);
CREATE INDEX IF NOT EXISTS idx_tabs_is_pinned ON public.tabs(workspace_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON public.sessions(user_id, created_at DESC);

-- ── Auto-update timestamps ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_tabs_updated_at ON public.tabs;
CREATE TRIGGER update_tabs_updated_at
  BEFORE UPDATE ON public.tabs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_devices ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (safe if they don't exist)
DO $$ BEGIN
  -- user_settings
  DROP POLICY IF EXISTS "Users can view own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can delete own settings" ON public.user_settings;
  -- workspaces
  DROP POLICY IF EXISTS "Users can view own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can create own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can update own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can delete own workspaces" ON public.workspaces;
  -- tabs
  DROP POLICY IF EXISTS "Users can view own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can create own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can update own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can delete own tabs" ON public.tabs;
  -- sessions
  DROP POLICY IF EXISTS "Users can view own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can create own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can update own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can delete own sessions" ON public.sessions;
  -- active_devices
  DROP POLICY IF EXISTS "Users can manage their own active device" ON public.active_devices;
END $$;

-- user_settings policies
CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own settings" ON public.user_settings FOR DELETE USING (auth.uid() = user_id);

-- workspaces policies
CREATE POLICY "Users can view own workspaces" ON public.workspaces FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own workspaces" ON public.workspaces FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workspaces" ON public.workspaces FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own workspaces" ON public.workspaces FOR DELETE USING (auth.uid() = user_id);

-- tabs policies
CREATE POLICY "Users can view own tabs" ON public.tabs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own tabs" ON public.tabs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tabs" ON public.tabs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own tabs" ON public.tabs FOR DELETE USING (auth.uid() = user_id);

-- sessions policies
CREATE POLICY "Users can view own sessions" ON public.sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own sessions" ON public.sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON public.sessions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON public.sessions FOR DELETE USING (auth.uid() = user_id);

-- active_devices policies
CREATE POLICY "Users can manage their own active device" ON public.active_devices FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Data API grants ─────────────────────────────────────────────────────────
-- Starting May 30, 2026, Supabase no longer grants Data API access to new
-- public-schema tables by default (and the same enforcement applies to all
-- existing projects from October 30, 2026 for newly-created tables). Without
-- these explicit grants, supabase-js calls return 42501 "permission denied".
--
-- We grant to `authenticated` and `service_role` only — TabFlow authenticates
-- users before any Data API call, so `anon` never needs access. The RLS
-- policies above still constrain WHICH rows each user can see.
--
-- Idempotent — re-running this script on existing installs is a no-op.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces      TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tabs            TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions        TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.active_devices  TO authenticated, service_role;

-- ── Workspace history sync (added 2026-06-22) ───────────────────────────────
-- Per-workspace tab snapshots used by the History panel for rewind. Mirrors
-- the local IndexedDB workspaceHistory table so history follows the user
-- across devices. Payload is encrypted client-side as a JSON string.

CREATE TABLE IF NOT EXISTS public.workspace_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  tab_snapshots jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_history_user_workspace_idx ON public.workspace_history(user_id, workspace_id, created_at DESC);

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

-- ── Deleted workspaces sync (added 2026-06-22) ──────────────────────────────
-- The recycle bin. Mirrors the local IndexedDB deletedWorkspaces table so
-- archive entries follow the user across devices. workspace_data holds the
-- encrypted JSON snapshot of the workspace + its tabs at deletion time.

CREATE TABLE IF NOT EXISTS public.deleted_workspaces (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  workspace_data jsonb NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deleted_workspaces_user_idx ON public.deleted_workspaces(user_id, deleted_at DESC);

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

-- ── Workspace shortName column (added 2026-06-22) ───────────────────────────
-- The 1-3 char label rendered on the pinned-tab favicon. Plaintext column
-- (not sensitive — short, deliberately abstract). Inherits the workspaces
-- table's existing grants via ALTER TABLE.
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS short_name text;

-- ── Preferences column (added 2026-05-12) ──────────────────────────────────
-- Free-form JSONB bag for UI/UX preferences that should sync across devices.
-- Currently holds: { sidebarWidth: <int> }. Existing rows get a `{}` default.
-- New tables in `public` post-May-30-2026 require explicit GRANT to use the
-- Data API, but ALTER TABLE ADD COLUMN inherits the existing grants of the
-- parent table — no additional GRANT needed for this column specifically.
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Note: ALTER PUBLICATION ... ADD TABLE is not idempotent in all Postgres
-- versions, so we use a DO block to handle the case where the table is
-- already in the publication.

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.workspaces;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tabs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.active_devices;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Done! ───────────────────────────────────────────────────────────────────
-- Your TabFlow database is ready. Go back to the extension and enter your
-- Supabase Project URL and anon key to connect.
