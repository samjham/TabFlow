/**
 * Browser launch and extension utilities for smoke tests.
 *
 * Launches Chrome with the TabFlow extension loaded from dist/.
 * Uses puppeteer-core so it connects to the locally installed Chrome
 * rather than downloading a separate Chromium.
 *
 * IMPORTANT: Chrome must be fully closed before running tests.
 * Puppeteer needs to launch its own Chrome instance with the
 * extension flags.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the built extension */
const EXTENSION_PATH = path.resolve(__dirname, '../../dist');

/** Find the Chrome executable on the user's system */
function findChrome(): string {
  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];

  // On Windows, also try the registry
  if (process.platform === 'win32') {
    try {
      const regPath = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve',
        { encoding: 'utf8' }
      );
      const match = regPath.match(/REG_SZ\s+(.+)/);
      if (match?.[1]) candidates.unshift(match[1].trim());
    } catch {
      // Registry query failed — continue with candidates
    }
  }

  const fs = require('fs');
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Chrome not found. Set CHROME_PATH environment variable to your Chrome executable.'
  );
}

/** Shared browser state */
let browser: Browser | null = null;
let extensionId: string | null = null;

/**
 * Launch Chrome with the TabFlow extension loaded.
 * Returns the browser instance and extension ID.
 */
export async function launchBrowser(): Promise<{ browser: Browser; extensionId: string }> {
  const chromePath = process.env.CHROME_PATH || findChrome();
  console.log(`[Test] Launching Chrome from: ${chromePath}`);
  console.log(`[Test] Loading extension from: ${EXTENSION_PATH}`);

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false, // Extensions don't work in headless mode
    args: [
      `--load-extension=${EXTENSION_PATH}`,
      `--disable-extensions-except=${EXTENSION_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      // Use a clean profile so tests start fresh
      '--user-data-dir=' + path.resolve(__dirname, '../../.test-profile'),
    ],
    defaultViewport: null,
  });

  // Wait for the service worker to register (indicates extension loaded)
  const swTarget = await browser.waitForTarget(
    (target) => target.type() === 'service_worker' && target.url().includes('background.js'),
    { timeout: 15_000 }
  );

  // Extract extension ID from the service worker URL
  // Format: chrome-extension://<id>/background.js
  const swUrl = swTarget.url();
  extensionId = new URL(swUrl).hostname;
  console.log(`[Test] Extension loaded, ID: ${extensionId}`);

  // Give the extension a moment to complete its startup IIFE
  await new Promise((r) => setTimeout(r, 3000));

  return { browser, extensionId };
}

/**
 * Close the browser and clean up.
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    extensionId = null;
  }
}

/**
 * Get the extension's new tab page URL.
 */
export function getNewTabUrl(): string {
  if (!extensionId) throw new Error('Browser not launched yet');
  return `chrome-extension://${extensionId}/newtab.html`;
}

/**
 * Open a new tab that triggers the TabFlow newtab override.
 * This also wakes the service worker (sends a message).
 */
export async function openNewTab(page: Page): Promise<Page> {
  if (!browser) throw new Error('Browser not launched yet');
  const newPage = await browser.newPage();
  await newPage.goto(getNewTabUrl(), { waitUntil: 'networkidle0' });
  return newPage;
}

/**
 * Get the current browser instance.
 */
export function getBrowser(): Browser {
  if (!browser) throw new Error('Browser not launched yet');
  return browser;
}

/**
 * Get the extension ID.
 */
export function getExtensionId(): string {
  if (!extensionId) throw new Error('Browser not launched yet');
  return extensionId;
}
