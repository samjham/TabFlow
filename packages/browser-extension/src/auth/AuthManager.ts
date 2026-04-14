/**
 * Authentication Manager for TabFlow Chrome Extension
 *
 * Handles user authentication with Supabase using email and password.
 * Provides a singleton Supabase client and manages auth state changes.
 *
 * @remarks
 * Uses Supabase's email/password authentication with the Web Crypto API.
 * Stores the client as a singleton for reuse across the extension.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from '../config';

/**
 * Custom storage adapter for Supabase auth that uses chrome.storage.local.
 *
 * Service workers don't have access to localStorage, so Supabase's default
 * session persistence silently fails. This adapter stores auth tokens in
 * chrome.storage.local, which is accessible from ALL extension contexts
 * (service worker, popup, newtab page, etc.) and persists across restarts.
 */
const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

/**
 * Type for the Supabase auth state change callback
 */
export type AuthStateChangeCallback = (
  event: 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED',
  session: { user: { id: string; email: string } } | null
) => void;

/**
 * Singleton instance of the Supabase client
 * Initialized on first call to initialize()
 */
let supabaseClient: SupabaseClient | null = null;

/**
 * Authentication callbacks registered via onAuthStateChange()
 */
const authCallbacks: Set<AuthStateChangeCallback> = new Set();

/**
 * Initializes or returns the singleton Supabase client.
 * Must be called before any auth operations.
 *
 * @returns The Supabase client instance
 * @throws Error if Supabase URL or key is not configured
 *
 * @example
 * ```ts
 * const client = await AuthManager.initialize();
 * ```
 */
export async function initialize(): Promise<SupabaseClient> {
  if (supabaseClient) {
    return supabaseClient;
  }

  const { url, anonKey } = await getSupabaseConfig();

  if (!url || !anonKey) {
    throw new Error(
      'Supabase configuration missing. Please complete the setup wizard.'
    );
  }

  supabaseClient = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: chromeStorageAdapter,
    },
  });

  // Set up auth state change listener
  supabaseClient.auth.onAuthStateChange((event, session) => {
    authCallbacks.forEach((callback) => {
      const authEvent = event as 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED';
      callback(authEvent, session ? { user: { id: session.user.id, email: session.user.email || '' } } : null);
    });
  });

  return supabaseClient;
}

/**
 * Gets the current Supabase client instance.
 *
 * @returns The Supabase client, or null if not initialized
 *
 * @example
 * ```ts
 * const client = AuthManager.getClient();
 * if (!client) {
 *   await AuthManager.initialize();
 * }
 * ```
 */
export function getClient(): SupabaseClient | null {
  return supabaseClient;
}

/**
 * Resets the singleton client so the next call to initialize() creates
 * a fresh client. Useful after updating Supabase credentials.
 */
export function resetClient(): void {
  supabaseClient = null;
}

/**
 * Registers a new user account with email and password.
 *
 * @param email - The user's email address
 * @param password - The user's password (must be at least 6 characters)
 * @returns Promise resolving to the user object on success
 * @throws Error if signup fails (e.g., email already exists)
 *
 * @example
 * ```ts
 * const user = await AuthManager.signUp('user@example.com', 'password123');
 * console.log('User registered:', user.id);
 * ```
 */
export async function signUp(
  email: string,
  password: string
): Promise<{ id: string; email: string }> {
  const client = await initialize();

  const { data, error } = await client.auth.signUp({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.user) {
    throw new Error('Signup succeeded but no user returned');
  }

  return {
    id: data.user.id,
    email: data.user.email || '',
  };
}

/**
 * Signs in a user with email and password.
 *
 * @param email - The user's email address
 * @param password - The user's password
 * @returns Promise resolving to the user object on success
 * @throws Error if signin fails (e.g., invalid credentials)
 *
 * @example
 * ```ts
 * const user = await AuthManager.signIn('user@example.com', 'password123');
 * console.log('Logged in as:', user.email);
 * ```
 */
export async function signIn(
  email: string,
  password: string
): Promise<{ id: string; email: string }> {
  const client = await initialize();

  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.user) {
    throw new Error('Signin succeeded but no user returned');
  }

  return {
    id: data.user.id,
    email: data.user.email || '',
  };
}

/**
 * Signs out the currently authenticated user.
 *
 * @returns Promise that resolves when signout is complete
 * @throws Error if signout fails
 *
 * @example
 * ```ts
 * await AuthManager.signOut();
 * console.log('Signed out successfully');
 * ```
 */
export async function signOut(): Promise<void> {
  const client = await initialize();

  const { error } = await client.auth.signOut();

  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Gets the current session if the user is authenticated.
 *
 * @returns Promise resolving to the session object, or null if not authenticated
 *
 * @example
 * ```ts
 * const session = await AuthManager.getSession();
 * if (session) {
 *   console.log('User is logged in:', session.user.email);
 * }
 * ```
 */
export async function getSession(): Promise<{ user: { id: string; email: string } } | null> {
  const client = await initialize();

  const {
    data: { session },
  } = await client.auth.getSession();

  if (!session) {
    return null;
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email || '',
    },
  };
}

/**
 * Gets the current authenticated user.
 *
 * @returns Promise resolving to the user object, or null if not authenticated
 *
 * @example
 * ```ts
 * const user = await AuthManager.getUser();
 * if (user) {
 *   console.log('Current user:', user.email);
 * }
 * ```
 */
export async function getUser(): Promise<{ id: string; email: string } | null> {
  const client = await initialize();

  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email || '',
  };
}

/**
 * Subscribes to authentication state changes.
 * The callback will be invoked whenever the user signs in, signs out, or their session is updated.
 *
 * @param callback - Function to call on auth state changes
 * @returns Unsubscribe function to remove the listener
 *
 * @example
 * ```ts
 * const unsubscribe = AuthManager.onAuthStateChange((event, session) => {
 *   if (event === 'SIGNED_IN') {
 *     console.log('User logged in:', session?.user.email);
 *   }
 * });
 *
 * // Later, unsubscribe if needed:
 * unsubscribe();
 * ```
 */
export function onAuthStateChange(callback: AuthStateChangeCallback): () => void {
  authCallbacks.add(callback);

  // Return unsubscribe function
  return () => {
    authCallbacks.delete(callback);
  };
}
