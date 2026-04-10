-- Active device tracking for multi-device sync.
--
-- Only one device per user is "active" at a time. The active device pushes
-- changes freely; all other devices display a "Resume Working Here" banner
-- and do NOT push changes.
--
-- A heartbeat column lets the system detect stale claims (e.g. a device
-- that crashed without releasing).

CREATE TABLE IF NOT EXISTS public.active_devices (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_name text NOT NULL DEFAULT 'Unknown Device',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

-- Row Level Security: each user can only see/modify their own row.
ALTER TABLE public.active_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own active device"
  ON public.active_devices
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add to realtime publication so devices get notified instantly when
-- another device claims the active session.
ALTER PUBLICATION supabase_realtime ADD TABLE public.active_devices;
