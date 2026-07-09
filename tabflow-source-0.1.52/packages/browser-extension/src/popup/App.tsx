/**
 * Root App component for TabFlow popup.
 * Checks local-only → Supabase config → auth → shows workspace Popup.
 */

import React, { useState, useEffect } from 'react';
import { SetupWizard } from '../auth/SetupWizard';
import { AuthPopup } from '../auth/AuthPopup';
import { Popup } from './Popup';
import * as AuthManager from '../auth/AuthManager';
import { isSupabaseConfigured, isLocalOnlyMode } from '../config';

type AppState = 'loading' | 'setup' | 'auth' | 'ready';

export const App: React.FC = () => {
  const [state, setState] = useState<AppState>('loading');
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);

  useEffect(() => {
    (async () => {
      const localOnly = await isLocalOnlyMode();
      if (localOnly) {
        setState('ready');
        return;
      }

      const configured = await isSupabaseConfigured();
      if (!configured) {
        setState('setup');
        return;
      }

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

  if (state === 'loading') {
    return (
      <div style={{
        width: '400px',
        minHeight: '500px',
        backgroundColor: '#1a1d27',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#8b8fa3',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        Loading...
      </div>
    );
  }

  if (state === 'setup') {
    return (
      <div style={{ width: '400px', minHeight: '500px', backgroundColor: '#0f1117' }}>
        <SetupWizard
          onComplete={() => setState('auth')}
          onSkip={() => setState('ready')}
        />
      </div>
    );
  }

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

  return <Popup user={user} onSignOut={handleSignOut} />;

  async function handleSignOut() {
    await AuthManager.signOut();
    if (chrome.storage) {
      chrome.storage.local.remove(['encryptionPassphrase', 'userId']);
    }
    setUser(null);
    setState('auth');
  }
};
