/**
 * React entry point for the New Tab page.
 *
 * Flow:
 *   1. Local-only mode (user skipped cloud sync) → NewTab (no auth)
 *   2. No Supabase credentials                   → SetupWizard
 *   3. Not authenticated                         → AuthPopup
 *   4. Authenticated                             → NewTab
 */

import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { SetupWizard } from '../auth/SetupWizard';
import { AuthPopup } from '../auth/AuthPopup';
import { NewTab } from './NewTab';
import * as AuthManager from '../auth/AuthManager';
import { isSupabaseConfigured, isLocalOnlyMode } from '../config';

type AppState = 'loading' | 'setup' | 'auth' | 'ready';

const AppContainer: React.FC = () => {
  const [state, setState] = useState<AppState>('loading');
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);

  useEffect(() => {
    (async () => {
      // Check if user chose local-only mode
      const localOnly = await isLocalOnlyMode();
      if (localOnly) {
        setState('ready');
        return;
      }

      // Check if Supabase is configured
      const configured = await isSupabaseConfigured();
      if (!configured) {
        setState('setup');
        return;
      }

      // Check if user is authenticated
      try {
        const session = await AuthManager.getSession();
        if (session) {
          setUser(session.user);
          setState('ready');
        } else {
          setState('auth');
        }
      } catch {
        setState('auth');
      }
    })();

    // Listen for auth changes
    const unsub = AuthManager.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user);
        setState('ready');
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setState('auth');
      }
    });

    return unsub;
  }, []);

  // Loading
  if (state === 'loading') {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          backgroundColor: '#0f1117',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8b8fa3',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        Loading...
      </div>
    );
  }

  // Setup wizard (no Supabase credentials yet)
  if (state === 'setup') {
    return (
      <div style={{ width: '100vw', height: '100vh', backgroundColor: '#0f1117' }}>
        <SetupWizard
          onComplete={() => setState('auth')}
          onSkip={() => setState('ready')}
        />
      </div>
    );
  }

  // Not authenticated — show login
  if (state === 'auth') {
    return (
      <AuthPopup
        onAuthenticated={(u) => {
          setUser(u);
          setState('ready');
          chrome.runtime.sendMessage({ type: 'AUTH_READY', payload: { userId: u.id } });
        }}
      />
    );
  }

  // Authenticated (or local-only) — show workspace manager
  return <NewTab user={user} onSignOut={handleSignOut} />;

  async function handleSignOut() {
    await AuthManager.signOut();
    if (chrome.storage) {
      chrome.storage.local.remove(['encryptionPassphrase', 'userId']);
    }
    setUser(null);
    setState('auth');
  }
};

// Mount the app
const root = createRoot(document.getElementById('root')!);
root.render(<AppContainer />);
