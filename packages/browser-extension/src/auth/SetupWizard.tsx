/**
 * First-run Setup Wizard for TabFlow
 *
 * Appears on first launch when no Supabase credentials are stored.
 *
 * Flow:
 *   welcome  → "Want cloud sync?" → No  → skip (local-only)
 *                                  → Yes → "Already have a Supabase account?"
 *                                            → Yes → enter-credentials
 *                                            → No  → new-project → run-sql → enter-credentials
 *   enter-credentials → test connection → success → onComplete (auth screen)
 */

import React, { useState } from 'react';
import { saveSupabaseConfig, clearConfigCache } from '../config';
import * as AuthManager from './AuthManager';

interface SetupWizardProps {
  /** Called when setup is complete (credentials saved) — show auth screen next */
  onComplete: () => void;
  /** Called when user chooses to skip cloud sync and use TabFlow locally */
  onSkip: () => void;
}

// Step IDs for the wizard flow
type WizardStep =
  | 'welcome'
  | 'has-account'
  | 'new-project'
  | 'run-sql'
  | 'enter-credentials'
  | 'success';

const SETUP_SQL = `-- TabFlow Database Setup — paste this entire block and click "Run"

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  encryption_salt text NOT NULL,
  canary text,
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

CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON public.workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_is_active ON public.workspaces(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tabs_workspace_id ON public.tabs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tabs_user_id ON public.tabs(user_id);
CREATE INDEX IF NOT EXISTS idx_tabs_is_pinned ON public.tabs(workspace_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON public.sessions(user_id, created_at DESC);

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

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_devices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can delete own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can view own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can create own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can update own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can delete own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can view own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can create own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can update own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can delete own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can view own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can create own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can update own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can delete own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can manage their own active device" ON public.active_devices;
END $$;

CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own settings" ON public.user_settings FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view own workspaces" ON public.workspaces FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own workspaces" ON public.workspaces FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workspaces" ON public.workspaces FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own workspaces" ON public.workspaces FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view own tabs" ON public.tabs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own tabs" ON public.tabs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tabs" ON public.tabs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own tabs" ON public.tabs FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view own sessions" ON public.sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own sessions" ON public.sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON public.sessions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON public.sessions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own active device" ON public.active_devices FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.workspaces; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tabs; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.active_devices; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

export const SetupWizard: React.FC<SetupWizardProps> = ({ onComplete, onSkip }) => {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  // Track whether user came via the "new project" path so the Back
  // button on enter-credentials knows where to go.
  const [cameFromNewProject, setCameFromNewProject] = useState(false);

  const handleCopySQL = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.getElementById('setup-sql-block');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  };

  const handleTestConnection = async () => {
    setError('');
    setTesting(true);

    try {
      if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
        setError('Both fields are required.');
        setTesting(false);
        return;
      }

      const urlTrimmed = supabaseUrl.trim().replace(/\/$/, '');
      if (!urlTrimmed.startsWith('https://') || !urlTrimmed.includes('.supabase.co')) {
        setError('URL should look like https://xxxxx.supabase.co');
        setTesting(false);
        return;
      }

      // Hit /auth/v1/settings — a public endpoint that validates the URL +
      // apikey pair without requiring any database schema or a user JWT.
      // This works with both legacy JWT anon keys and new sb_publishable_* keys.
      const response = await fetch(`${urlTrimmed}/auth/v1/settings`, {
        headers: {
          apikey: supabaseAnonKey.trim(),
        },
      });

      if (!response.ok) {
        let msg: string;
        switch (response.status) {
          case 401:
            msg =
              'HTTP 401: your API key is being rejected. Most common causes: ' +
              '(1) the key was copied incomplete — publishable/anon keys are usually 40+ characters; ' +
              '(2) you copied the JWT "secret" or "service_role" key by mistake; ' +
              '(3) the project is paused on Supabase (free projects pause after 1 week of inactivity — visit your dashboard to resume it).';
            break;
          case 403:
            msg =
              'HTTP 403: key accepted but access is denied. Check that you copied the ' +
              '"anon" or "publishable" key (not a restricted/scoped key).';
            break;
          case 404:
            msg =
              'HTTP 404: the Project URL seems wrong. It should look like ' +
              '"https://<project-ref>.supabase.co" where <project-ref> is a ~20-character string.';
            break;
          case 500:
          case 502:
          case 503:
          case 504:
            msg = `HTTP ${response.status}: Supabase is having trouble responding. Wait a moment and try again.`;
            break;
          default:
            msg = `Connection failed (HTTP ${response.status}). Double-check your URL and anon key.`;
        }
        setError(msg);
        setTesting(false);
        return;
      }

      await saveSupabaseConfig(urlTrimmed, supabaseAnonKey.trim());
      clearConfigCache();
      AuthManager.resetClient();

      setStep('success');
    } catch (err) {
      setError('Could not reach the Supabase project. Check your URL and try again.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>

        {/* ─── Welcome ─────────────────────────────────────────────── */}
        {step === 'welcome' && (
          <>
            <h1 style={styles.heading}>Welcome to TabFlow</h1>
            <p style={styles.body}>
              TabFlow organizes your browser tabs into workspaces. You can use
              it entirely on this computer, or enable cloud sync to keep your
              workspaces in sync across multiple devices.
            </p>
            <p style={{ ...styles.body, fontWeight: 500, color: '#d0d8e0' }}>
              Would you like to enable cloud sync?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
              <button
                style={styles.primaryButton}
                onClick={() => setStep('has-account')}
              >
                Yes, set up cloud sync
              </button>
              <button
                style={styles.secondaryButtonFull}
                onClick={() => {
                  // Persist the choice so we don't ask again
                  chrome.storage.local.set({ tabflow_local_only: true });
                  onSkip();
                }}
              >
                No thanks, just use it on this device
              </button>
            </div>
          </>
        )}

        {/* ─── Has existing account? ───────────────────────────────── */}
        {step === 'has-account' && (
          <>
            <h1 style={styles.heading}>Cloud Sync Setup</h1>
            <p style={styles.body}>
              TabFlow uses{' '}
              <a href="https://supabase.com" target="_blank" rel="noopener noreferrer" style={styles.link}>
                Supabase
              </a>{' '}
              (a free cloud database) to sync your tabs. Your data is
              end-to-end encrypted — nobody can read it except you.
            </p>
            <p style={{ ...styles.body, fontWeight: 500, color: '#d0d8e0' }}>
              Do you already have a Supabase project set up for TabFlow?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px' }}>
              <button
                style={styles.primaryButton}
                onClick={() => {
                  setCameFromNewProject(false);
                  setStep('enter-credentials');
                }}
              >
                Yes, I have my project URL and key
              </button>
              <button
                style={styles.secondaryButtonFull}
                onClick={() => {
                  setCameFromNewProject(true);
                  setStep('new-project');
                }}
              >
                No, I need to create one (free, ~5 min)
              </button>
            </div>
            <div style={{ marginTop: '16px', textAlign: 'center' as const }}>
              <a
                style={{ ...styles.link, fontSize: '13px', cursor: 'pointer' }}
                onClick={() => setStep('welcome')}
              >
                Back
              </a>
            </div>
          </>
        )}

        {/* ─── New project instructions ────────────────────────────── */}
        {step === 'new-project' && (
          <>
            <h1 style={styles.heading}>Create a Supabase Project</h1>

            <div style={styles.instructionBlock}>
              <div style={styles.instructionNumber}>1</div>
              <div>
                <p style={styles.body}>
                  Go to{' '}
                  <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" style={styles.link}>
                    supabase.com/dashboard
                  </a>{' '}
                  and create a free account (or sign in).
                </p>
              </div>
            </div>

            <div style={styles.instructionBlock}>
              <div style={styles.instructionNumber}>2</div>
              <div>
                <p style={styles.body}>
                  Click <strong style={{ color: '#e0e6ed' }}>New Project</strong>. Pick any name
                  and a strong database password (you won't need this password in TabFlow).
                </p>
              </div>
            </div>

            <div style={styles.instructionBlock}>
              <div style={styles.instructionNumber}>3</div>
              <div>
                <p style={styles.body}>
                  Wait for the project to finish setting up (about 1 minute), then continue.
                </p>
              </div>
            </div>

            <div style={styles.buttonRow}>
              <button style={styles.secondaryButton} onClick={() => setStep('has-account')}>
                Back
              </button>
              <button style={styles.primaryButton} onClick={() => setStep('run-sql')}>
                My Project is Ready
              </button>
            </div>
          </>
        )}

        {/* ─── Run SQL ─────────────────────────────────────────────── */}
        {step === 'run-sql' && (
          <>
            <h1 style={styles.heading}>Set Up the Database</h1>

            <div style={styles.instructionBlock}>
              <div style={styles.instructionNumber}>1</div>
              <div>
                <p style={styles.body}>
                  In your Supabase dashboard, click{' '}
                  <strong style={{ color: '#e0e6ed' }}>SQL Editor</strong> in the left sidebar.
                </p>
              </div>
            </div>

            <div style={styles.instructionBlock}>
              <div style={styles.instructionNumber}>2</div>
              <div>
                <p style={styles.body}>
                  Click <strong style={{ color: '#e0e6ed' }}>New Query</strong>, paste the SQL
                  below, and click <strong style={{ color: '#e0e6ed' }}>Run</strong>.
                </p>
              </div>
            </div>

            <div style={styles.sqlContainer}>
              <div style={styles.sqlHeader}>
                <span style={{ fontSize: '12px', color: '#8b8fa3' }}>TabFlow Setup SQL</span>
                <button style={styles.copyButton} onClick={handleCopySQL}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre id="setup-sql-block" style={styles.sqlBlock}>
                {SETUP_SQL.slice(0, 500) + '\n\n  ... (click Copy to get the full script)'}
              </pre>
            </div>

            <div style={styles.buttonRow}>
              <button style={styles.secondaryButton} onClick={() => setStep('new-project')}>
                Back
              </button>
              <button
                style={styles.primaryButton}
                onClick={() => setStep('enter-credentials')}
              >
                I've Run the SQL
              </button>
            </div>
          </>
        )}

        {/* ─── Enter credentials ───────────────────────────────────── */}
        {step === 'enter-credentials' && (
          <>
            <h1 style={styles.heading}>Connect Your Supabase Project</h1>
            <p style={styles.body}>
              Grab two values from your Supabase project dashboard:
            </p>

            <ol style={styles.steps}>
              <li style={styles.step}>
                Open{' '}
                <a
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noreferrer"
                  style={styles.link}
                >
                  supabase.com/dashboard
                </a>{' '}
                and click into your project.
              </li>
              <li style={styles.step}>
                The <strong style={{ color: '#e0e6ed' }}>Project URL</strong> is shown right under
                your project name at the top of the page (it looks like{' '}
                <code style={styles.code}>https://xxxxx.supabase.co</code>). Use the{' '}
                <strong style={{ color: '#e0e6ed' }}>Copy</strong> button next to it and paste it below.
              </li>
              <li style={styles.step}>
                For the <strong style={{ color: '#e0e6ed' }}>API key</strong>, click{' '}
                <strong style={{ color: '#e0e6ed' }}>API Keys</strong> in the "Get connected" row on
                the dashboard (or in the left-hand gear menu). Copy the key labeled{' '}
                <em>"publishable"</em> (starts with <code style={styles.code}>sb_publishable_…</code>)
                or <em>"anon public"</em> (starts with <code style={styles.code}>eyJ…</code>) —
                either format works.
                <div style={{ marginTop: '8px' }}>
                  <strong style={{ color: '#ff7a7a' }}>Do not</strong> copy any key labeled{' '}
                  <em>"secret"</em> or <em>"service_role"</em> — those have admin access and must
                  never be in a browser extension.
                </div>
              </li>
            </ol>

            {error && <div style={styles.errorBox}>{error}</div>}

            <div style={styles.formGroup}>
              <label style={styles.label}>Project URL</label>
              <input
                style={styles.input}
                type="text"
                placeholder="https://abcdefghijklmnop.supabase.co"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#6c8cff')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#3a3f4b')}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Anon / Publishable Key</label>
              <input
                style={styles.input}
                type="text"
                placeholder="eyJhbGciOi…  or  sb_publishable_…"
                value={supabaseAnonKey}
                onChange={(e) => setSupabaseAnonKey(e.target.value)}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#6c8cff')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#3a3f4b')}
              />
              <span style={styles.hint}>
                Usually 40+ characters. Paste the whole thing — getting cut off causes 401 errors.
              </span>
            </div>

            <div style={styles.buttonRow}>
              <button
                style={styles.secondaryButton}
                onClick={() => setStep(cameFromNewProject ? 'run-sql' : 'has-account')}
              >
                Back
              </button>
              <button
                style={{ ...styles.primaryButton, opacity: testing ? 0.7 : 1 }}
                onClick={handleTestConnection}
                disabled={testing}
              >
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
            </div>
          </>
        )}

        {/* ─── Success ─────────────────────────────────────────────── */}
        {step === 'success' && (
          <>
            <div style={styles.successIcon}>✓</div>
            <h1 style={styles.heading}>Connected!</h1>
            <p style={styles.body}>
              TabFlow is connected to your Supabase project. Next, create an
              account (or sign in) and set your encryption passphrase.
            </p>
            <button style={styles.primaryButton} onClick={onComplete}>
              Continue to Sign In
            </button>
          </>
        )}
      </div>
    </div>
  );
};

// ─── Styles ────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    minHeight: '100%',
    backgroundColor: '#0f1117',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    boxSizing: 'border-box',
  },
  card: {
    width: '100%',
    maxWidth: '560px',
    backgroundColor: '#1a1d27',
    borderRadius: '12px',
    padding: '36px 32px',
    border: '1px solid #2a2d3a',
  },
  heading: {
    fontSize: '22px',
    fontWeight: 600,
    color: '#e0e6ed',
    marginBottom: '12px',
    marginTop: 0,
    textAlign: 'center' as const,
  },
  body: {
    fontSize: '14px',
    color: '#9ca3af',
    lineHeight: 1.6,
    marginBottom: '12px',
    marginTop: 0,
  },
  instructionBlock: {
    display: 'flex',
    gap: '14px',
    alignItems: 'flex-start',
    marginBottom: '16px',
  },
  instructionNumber: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    backgroundColor: '#6c8cff',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    fontWeight: 700,
    flexShrink: 0,
    marginTop: '2px',
  },
  sqlContainer: {
    borderRadius: '8px',
    border: '1px solid #2a2d3a',
    overflow: 'hidden',
    marginBottom: '24px',
  },
  sqlHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: '#12141c',
    borderBottom: '1px solid #2a2d3a',
  },
  copyButton: {
    backgroundColor: '#6c8cff',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 12px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  sqlBlock: {
    backgroundColor: '#12141c',
    color: '#8b8fa3',
    padding: '12px',
    fontSize: '11px',
    lineHeight: 1.5,
    overflow: 'auto',
    maxHeight: '180px',
    margin: 0,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  },
  formGroup: {
    marginBottom: '18px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 500,
    color: '#d0d8e0',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#12141c',
    border: '1px solid #3a3f4b',
    borderRadius: '6px',
    color: '#e0e6ed',
    fontSize: '14px',
    boxSizing: 'border-box' as const,
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  hint: {
    fontSize: '12px',
    color: '#6b7080',
    marginTop: '4px',
    display: 'block',
  },
  steps: {
    paddingLeft: '22px',
    margin: '0 0 20px 0',
    color: '#b8c0cc',
    fontSize: '14px',
    lineHeight: '1.65',
  },
  step: {
    marginBottom: '10px',
  },
  subSteps: {
    paddingLeft: '18px',
    marginTop: '6px',
    marginBottom: '6px',
    color: '#b8c0cc',
    fontSize: '13px',
    listStyleType: 'disc' as const,
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '12px',
    backgroundColor: '#12141c',
    border: '1px solid #2a2f3a',
    borderRadius: '4px',
    padding: '1px 5px',
    color: '#e0e6ed',
  },
  link: {
    color: '#6c8cff',
    textDecoration: 'none',
  },
  errorBox: {
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    padding: '12px',
    borderRadius: '6px',
    fontSize: '13px',
    lineHeight: '1.55',
    marginBottom: '16px',
  },
  buttonRow: {
    display: 'flex',
    gap: '12px',
    justifyContent: 'flex-end',
    marginTop: '24px',
  },
  primaryButton: {
    backgroundColor: '#6c8cff',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 24px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    color: '#8b8fa3',
    border: '1px solid #3a3f4b',
    borderRadius: '8px',
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  secondaryButtonFull: {
    backgroundColor: 'transparent',
    color: '#8b8fa3',
    border: '1px solid #3a3f4b',
    borderRadius: '8px',
    padding: '10px 24px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    width: '100%',
  },
  successIcon: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    backgroundColor: '#166534',
    color: '#4ade80',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '28px',
    fontWeight: 700,
    margin: '0 auto 20px',
  },
};

export default SetupWizard;
