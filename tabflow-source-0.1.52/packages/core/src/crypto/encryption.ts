/**
 * E2E Encryption module for TabFlow
 *
 * Provides client-side encryption of sensitive data (URLs, titles) using:
 * - PBKDF2 for key derivation (100,000 iterations, SHA-256)
 * - AES-GCM-256 for authenticated encryption (12-byte IV, 16-byte salt)
 * - Web Crypto API (no external dependencies)
 *
 * All encrypted data is base64-encoded as: [salt (16 bytes) + iv (12 bytes) + ciphertext]
 * This format allows single-string storage in databases.
 */

/**
 * Helper: Encode Uint8Array to base64 string
 */
export function toBase64(bytes: Uint8Array): string {
  const binary = String.fromCharCode.apply(null, Array.from(bytes));
  return btoa(binary);
}

/**
 * Helper: Decode base64 string to Uint8Array
 */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generates a random Uint8Array of the specified length
 */
function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Derives an AES-GCM-256 key from a password and salt using PBKDF2.
 *
 * @param password - The user's password
 * @param salt - Optional salt; if not provided, generates a random 16-byte salt
 * @returns Promise resolving to { key: CryptoKey, salt: Uint8Array }
 *
 * The salt should be stored once per user (not per encryption) and reused
 * for all key derivations with the same password.
 */
export async function deriveKey(
  password: string,
  salt?: Uint8Array
): Promise<{ key: CryptoKey; salt: Uint8Array }> {
  // Generate salt if not provided
  const derivedSalt = salt ?? generateRandomBytes(16);

  // Convert password to Uint8Array
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);

  // Import the password as a key material
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  // Derive 256-bit (32-byte) key using PBKDF2
  const derivedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: derivedSalt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256 // 256 bits = 32 bytes for AES-256
  );

  // Import the derived bits as an AES-GCM key
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    derivedBits,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  return { key, salt: derivedSalt };
}

/**
 * Encrypts a plaintext string using AES-GCM-256.
 *
 * @param plaintext - The string to encrypt
 * @param key - CryptoKey derived from deriveKey()
 * @returns Promise resolving to base64-encoded string containing: salt + iv + ciphertext
 *
 * The returned string is a single, self-contained value that can be stored
 * directly in the database. The IV is randomly generated for each encryption
 * to ensure semantic security (same plaintext encrypts differently each time).
 */
export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  // Generate a random 12-byte IV for each encryption
  const iv = generateRandomBytes(12);

  // Convert plaintext to bytes
  const encoder = new TextEncoder();
  const plaintextBuffer = encoder.encode(plaintext);

  // Encrypt using AES-GCM
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv } as any,
    key,
    plaintextBuffer
  );

  // Combine: iv (12 bytes) + ciphertext
  // Note: salt is stored separately (per-user), not per encryption
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(new Uint8Array(iv), 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);

  // Return as base64
  return toBase64(combined);
}

/**
 * Decrypts a base64-encoded encrypted string back to plaintext.
 *
 * @param encrypted - Base64-encoded string from encrypt()
 * @param key - CryptoKey derived from deriveKey() (must be the same key used for encryption)
 * @returns Promise resolving to the original plaintext
 *
 * Extracts the IV from the encrypted payload and uses it to decrypt.
 */
export async function decrypt(encrypted: string, key: CryptoKey): Promise<string> {
  // Decode from base64
  const combined = fromBase64(encrypted);

  // Extract IV (first 12 bytes) and ciphertext (remainder)
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  // Decrypt using AES-GCM
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  // Convert bytes back to string
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * Encrypts a tab object's sensitive fields (url and title).
 *
 * @param tab - Tab object with url and title fields
 * @param key - CryptoKey derived from deriveKey()
 * @returns Promise resolving to a new object with encrypted url and title
 *
 * Returns a shallow copy of the tab object with url and title encrypted
 * and base64-encoded. Other fields are left unchanged.
 */
export async function encryptTab(
  tab: { url: string; title: string; [key: string]: any },
  key: CryptoKey
): Promise<typeof tab> {
  const [encryptedUrl, encryptedTitle] = await Promise.all([
    encrypt(tab.url, key),
    encrypt(tab.title, key),
  ]);

  return {
    ...tab,
    url: encryptedUrl,
    title: encryptedTitle,
  };
}

/**
 * Decrypts a tab object's sensitive fields (url and title).
 *
 * @param tab - Tab object with encrypted url and title fields
 * @param key - CryptoKey derived from deriveKey() (must be the same key used for encryption)
 * @returns Promise resolving to a new object with decrypted url and title
 *
 * Returns a shallow copy of the tab object with url and title decrypted.
 * Other fields are left unchanged.
 */
export async function decryptTab(
  tab: { url: string; title: string; [key: string]: any },
  key: CryptoKey
): Promise<typeof tab> {
  const [decryptedUrl, decryptedTitle] = await Promise.all([
    decrypt(tab.url, key),
    decrypt(tab.title, key),
  ]);

  return {
    ...tab,
    url: decryptedUrl,
    title: decryptedTitle,
  };
}
