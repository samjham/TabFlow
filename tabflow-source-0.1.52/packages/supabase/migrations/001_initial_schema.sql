-- TabFlow: Initial Database Schema
-- This migration creates the core tables and security policies for TabFlow,
-- a browser tab manager with encryption support and real-time synchronization.

-- ============================================================================
-- TABLES
-- ============================================================================

-- User Settings Table
-- Stores encryption metadata for each user. The encryption_salt is used for
-- client-side key derivation without exposing sensitive data to the server.
CREATE TABLE public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  encryption_salt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_settings IS 'User encryption configuration and metadata';

-- Workspaces Table
-- Represents a collection of tabs organized by the user. Supports multiple
-- workspaces for different contexts (e.g., work, personal, projects).
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspaces IS 'Tab workspaces for organizing related browser tabs';

-- Create indexes on workspaces for common queries
CREATE INDEX idx_workspaces_user_id ON public.workspaces(user_id);
CREATE INDEX idx_workspaces_is_active ON public.workspaces(user_id, is_active);

-- Tabs Table
-- Stores individual browser tabs. The workspace_id ties tabs to workspaces,
-- and user_id is denormalized for efficient RLS and real-time filtering.
CREATE TABLE public.tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL,
  favicon_url text,
  sort_order integer NOT NULL DEFAULT 0,
  is_pinned boolean NOT NULL DEFAULT false,
  last_accessed timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tabs IS 'Browser tabs stored in workspaces with encryption';

-- Create indexes on tabs for common queries
CREATE INDEX idx_tabs_workspace_id ON public.tabs(workspace_id);
CREATE INDEX idx_tabs_user_id ON public.tabs(user_id);
CREATE INDEX idx_tabs_is_pinned ON public.tabs(workspace_id, is_pinned);

-- Sessions Table
-- Stores snapshots of tab arrangements for session management and recovery.
-- The snapshot is a JSONB object containing workspace and tab metadata.
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sessions IS 'Session snapshots for tab recovery and management';

-- Create indexes on sessions for common queries
CREATE INDEX idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX idx_sessions_created_at ON public.sessions(user_id, created_at DESC);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to update the updated_at timestamp
-- This function is called by triggers on tables with updated_at columns
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Automatically update the updated_at column on workspaces
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Automatically update the updated_at column on tabs
CREATE TRIGGER update_tabs_updated_at
  BEFORE UPDATE ON public.tabs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- User Settings Policies
-- Users can only view and modify their own settings
CREATE POLICY "Users can view own settings"
  ON public.user_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON public.user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON public.user_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own settings"
  ON public.user_settings FOR DELETE
  USING (auth.uid() = user_id);

-- Workspaces Policies
-- Users can only see, create, modify, and delete their own workspaces
CREATE POLICY "Users can view own workspaces"
  ON public.workspaces FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own workspaces"
  ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workspaces"
  ON public.workspaces FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own workspaces"
  ON public.workspaces FOR DELETE
  USING (auth.uid() = user_id);

-- Tabs Policies
-- Users can only see, create, modify, and delete tabs in their own workspaces
CREATE POLICY "Users can view own tabs"
  ON public.tabs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tabs"
  ON public.tabs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tabs"
  ON public.tabs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tabs"
  ON public.tabs FOR DELETE
  USING (auth.uid() = user_id);

-- Sessions Policies
-- Users can only see, create, modify, and delete their own sessions
CREATE POLICY "Users can view own sessions"
  ON public.sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own sessions"
  ON public.sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON public.sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
  ON public.sessions FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- REALTIME SUBSCRIPTIONS
-- ============================================================================

-- Enable real-time synchronization for workspaces and tabs
-- This allows clients to subscribe to changes and receive updates in real-time
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspaces;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tabs;

-- ============================================================================
-- COMMENTS AND DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN public.user_settings.encryption_salt IS
  'Base64-encoded salt used for client-side encryption key derivation. Never transmitted to server after initial setup.';

COMMENT ON COLUMN public.workspaces.name IS
  'Encrypted workspace name. Decryption happens on the client.';

COMMENT ON COLUMN public.workspaces.color IS
  'Workspace color for UI display (e.g., #FF5733 or hex color code)';

COMMENT ON COLUMN public.workspaces.icon IS
  'Optional emoji or icon identifier for the workspace';

COMMENT ON COLUMN public.workspaces.sort_order IS
  'Order for sorting workspaces in the UI (user-defined)';

COMMENT ON COLUMN public.workspaces.is_active IS
  'Indicates if this is the currently active workspace';

COMMENT ON COLUMN public.workspaces.version IS
  'Version number for optimistic concurrency control';

COMMENT ON COLUMN public.tabs.url IS
  'Encrypted tab URL. Decryption happens on the client.';

COMMENT ON COLUMN public.tabs.title IS
  'Encrypted tab title. Decryption happens on the client.';

COMMENT ON COLUMN public.tabs.favicon_url IS
  'Public URL to the tab favicon (not encrypted)';

COMMENT ON COLUMN public.tabs.sort_order IS
  'Order for sorting tabs within a workspace (user-defined)';

COMMENT ON COLUMN public.tabs.is_pinned IS
  'Whether the tab is pinned to the top of the workspace';

COMMENT ON COLUMN public.tabs.last_accessed IS
  'Timestamp of when the user last accessed this tab';

COMMENT ON COLUMN public.sessions.snapshot IS
  'JSONB snapshot of workspaces and tabs at the time of creation. Encrypted on client.';
