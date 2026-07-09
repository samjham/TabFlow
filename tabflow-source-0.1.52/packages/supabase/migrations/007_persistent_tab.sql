-- 007_persistent_tab.sql
-- Adds a per-tab "persistent" flag used by the 0.1.46 tab-preservation feature.
-- When true, the tab is hidden (via Firefox's chrome.tabs.hide()) on workspace
-- switch instead of being closed, so PIP videos, form state, audio, etc. survive.
--
-- Firefox-only at the runtime layer, but stored in the shared schema so the
-- setting follows the user across devices via cross-device sync.
--
-- Idempotent — safe to re-run.

ALTER TABLE public.tabs ADD COLUMN IF NOT EXISTS persistent boolean NOT NULL DEFAULT false;
