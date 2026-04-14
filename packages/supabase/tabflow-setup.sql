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
  updated_at timestamptz NOT NULL DEFAULT now()
);

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
