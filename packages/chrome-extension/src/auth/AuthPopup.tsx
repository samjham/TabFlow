/**
 * Authentication Popup Component for TabFlow Chrome Extension
 *
 * Provides a login/signup form with support for both authentication
 * and encryption passphrase setup. Uses a dark theme matching the
 * existing extension UI.
 *
 * @remarks
 * The encryption passphrase is separate from the login password.
 * It never leaves the user's device and is used to derive the E2E encryption key.
 */

import React, { useState, useEffect } from 'react';
import * as AuthManager from './AuthManager';

/**
 * Props for the AuthPopup component
 */
interface AuthPopupProps {
  /** Callback invoked when authentication succeeds */
  onAuthenticated?: (user: { id: string; email: string }) => void;
}

/**
 * Authentication popup with login and signup modes.
 *
 * Provides a form for user registration or login, with an additional
 * field for setting the encryption passphrase used for E2E encryption.
 *
 * @example
 * ```tsx
 * <AuthPopup
 *   onAuthenticated={(user) => {
 *     console.log('User authenticated:', user.email);
 *   }}
 * />
 * ```
 */
export const AuthPopup: React.FC<AuthPopupProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [encryptionPassphrase, setEncryptionPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Restore form state when popup reopens (survives popup close/reopen)
  useEffect(() => {
    chrome.storage.session?.get(
      ['authForm_mode', 'authForm_email', 'authForm_password', 'authForm_passphrase'],
      (data) => {
        if (data.authForm_mode) setMode(data.authForm_mode);
        if (data.authForm_email) setEmail(data.authForm_email);
        if (data.authForm_password) setPassword(data.authForm_password);
        if (data.authForm_passphrase) setEncryptionPassphrase(data.authForm_passphrase);
      }
    );
  }, []);

  // Save form state as user types so it persists across popup close/reopen
  const updateField = (field: string, value: string, setter: (v: string) => void) => {
    setter(value);
    chrome.storage.session?.set({ [`authForm_${field}`]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate inputs
      if (!email || !password || !encryptionPassphrase) {
        setError('All fields are required');
        setLoading(false);
        return;
      }

      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        setLoading(false);
        return;
      }

      if (encryptionPassphrase.length < 8) {
        setError('Encryption passphrase must be at least 8 characters');
        setLoading(false);
        return;
      }

      let user;

      if (mode === 'signup') {
        user = await AuthManager.signUp(email, password);
      } else {
        user = await AuthManager.signIn(email, password);
      }

      // Store the encryption passphrase and clear the temporary form data
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({
          encryptionPassphrase,
          userId: user.id,
        });
        chrome.storage.session?.remove([
          'authForm_mode', 'authForm_email', 'authForm_password', 'authForm_passphrase'
        ]);
      }

      if (onAuthenticated) {
        onAuthenticated(user);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const containerStyle: React.CSSProperties = {
    backgroundColor: '#1a1d27',
    color: '#e0e6ed',
    width: '400px',
    minHeight: '500px',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  };

  const formStyle: React.CSSProperties = {
    width: '100%',
    backgroundColor: '#1a1d27',
    borderRadius: '0',
    padding: '24px 20px',
    boxShadow: 'none',
  };

  const headingStyle: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: '600',
    marginBottom: '8px',
    textAlign: 'center',
  };

  const subheadingStyle: React.CSSProperties = {
    fontSize: '14px',
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: '24px',
  };

  const formGroupStyle: React.CSSProperties = {
    marginBottom: '16px',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '13px',
    fontWeight: '500',
    marginBottom: '6px',
    color: '#d0d8e0',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: '#1a1d27',
    border: '1px solid #3a3f4b',
    borderRadius: '6px',
    color: '#e0e6ed',
    fontSize: '14px',
    boxSizing: 'border-box',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  const inputFocusStyle: React.CSSProperties = {
    ...inputStyle,
    borderColor: '#6c8cff',
  };

  const passphraseHintStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#9ca3af',
    marginTop: '4px',
    fontStyle: 'italic',
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px',
    backgroundColor: '#6c8cff',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: loading ? 'not-allowed' : 'pointer',
    opacity: loading ? 0.7 : 1,
    marginTop: '20px',
    transition: 'opacity 0.2s',
  };

  const errorStyle: React.CSSProperties = {
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    padding: '12px',
    borderRadius: '6px',
    fontSize: '13px',
    marginBottom: '16px',
  };

  const toggleStyle: React.CSSProperties = {
    textAlign: 'center',
    marginTop: '16px',
    fontSize: '13px',
  };

  const toggleLinkStyle: React.CSSProperties = {
    color: '#6c8cff',
    cursor: 'pointer',
    textDecoration: 'none',
  };

  return (
    <div style={containerStyle}>
      <form style={formStyle} onSubmit={handleSubmit}>
        <h1 style={headingStyle}>
          {mode === 'signin' ? 'Sign In' : 'Create Account'}
        </h1>
        <p style={subheadingStyle}>
          {mode === 'signin'
            ? 'Welcome back to TabFlow'
            : 'Join TabFlow and sync your tabs'}
        </p>

        {error && <div style={errorStyle}>{error}</div>}

        <div style={formGroupStyle}>
          <label htmlFor="tabflow-email" style={labelStyle}>Email</label>
          <input
            id="tabflow-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => updateField('email', e.target.value, setEmail)}
            placeholder="you@example.com"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#6c8cff')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#3a3f4b')}
            disabled={loading}
            required
          />
        </div>

        <div style={formGroupStyle}>
          <label htmlFor="tabflow-password" style={labelStyle}>Password</label>
          <input
            id="tabflow-password"
            name="password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => updateField('password', e.target.value, setPassword)}
            placeholder="At least 6 characters"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#6c8cff')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#3a3f4b')}
            disabled={loading}
            required
          />
        </div>

        <div style={formGroupStyle}>
          <label htmlFor="tabflow-passphrase" style={labelStyle}>Encryption Passphrase</label>
          <input
            id="tabflow-passphrase"
            name="passphrase"
            type="password"
            autoComplete="off"
            value={encryptionPassphrase}
            onChange={(e) => updateField('passphrase', e.target.value, setEncryptionPassphrase)}
            placeholder="Create a strong passphrase"
            style={inputStyle}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#6c8cff')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#3a3f4b')}
            disabled={loading}
            required
          />
          <div style={passphraseHintStyle}>
            This passphrase encrypts your data. It never leaves your device.
          </div>
        </div>

        <button type="submit" style={buttonStyle} disabled={loading}>
          {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
        </button>

        <div style={toggleStyle}>
          {mode === 'signin' ? (
            <>
              Don't have an account?{' '}
              <a
                style={toggleLinkStyle}
                onClick={() => {
                  setMode('signup');
                  setError('');
                  chrome.storage.session?.set({ authForm_mode: 'signup' });
                }}
              >
                Sign up
              </a>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <a
                style={toggleLinkStyle}
                onClick={() => {
                  setMode('signin');
                  setError('');
                  chrome.storage.session?.set({ authForm_mode: 'signin' });
                }}
              >
                Sign in
              </a>
            </>
          )}
        </div>
      </form>
    </div>
  );
};

export default AuthPopup;
