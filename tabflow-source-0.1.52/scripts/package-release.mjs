#!/usr/bin/env node
/**
 * TabFlow release packaging script.
 *
 * Run with `npm run release` (which runs `npm run build` first) or
 * `node scripts/package-release.mjs` directly if builds are already fresh.
 *
 * Produces four zip files at the project root, all tagged with the
 * manifest version:
 *
 *   tabflow-chrome-<VERSION>.zip         — dev build (with `key` field;
 *                                          load unpacked in Chrome to
 *                                          keep the pinned extension ID)
 *   tabflow-chrome-<VERSION>-store.zip   — Chrome Web Store upload
 *                                          (`key` field stripped so the
 *                                          store uses its stored key)
 *   tabflow-firefox-<VERSION>.zip        — AMO upload
 *   tabflow-source-<VERSION>.zip         — AMO source requirement
 *                                          (source code + build
 *                                          instructions; excludes
 *                                          node_modules / dist / .git
 *                                          / build artifacts)
 *
 * Why two Chrome zips: the first submission of TabFlow (2026-04-12) went
 * up without a `key` field, so Chrome Web Store generated and stored its
 * own public key — which determines the listing's extension ID
 * (`gkcamehohljdpenmjmoaciigppdbjcgl`). Later (2026-04-13) a `key` field
 * was added to `public/manifest.chrome.json` so that unpacked dev
 * installs get the same stable ID across folder renames. That key does
 * not match the one Web Store has on file, so uploads that include a
 * `key` field are rejected with "key field value in the manifest doesn't
 * match the current item". Solution: strip the key for the store zip,
 * keep it for the dev zip.
 */

import { createRequire } from 'module';
import { readFileSync, createWriteStream, existsSync, statSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// ─── Version ─────────────────────────────────────────────────────────
const manifestPath = path.join(root, 'packages/browser-extension/public/manifest.chrome.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
console.log(`\n[release] Packaging TabFlow v${version}\n`);

// ─── Sanity: dists exist ─────────────────────────────────────────────
const chromeDist = path.join(root, 'packages/browser-extension/dist/chrome');
const firefoxDist = path.join(root, 'packages/browser-extension/dist/firefox');
for (const [name, p] of [['chrome', chromeDist], ['firefox', firefoxDist]]) {
  if (!existsSync(path.join(p, 'manifest.json'))) {
    console.error(`[release] Missing ${name} build at ${p}.`);
    console.error(`[release] Run \`npm run build\` first, or use \`npm run release\` which runs build before this script.`);
    process.exit(1);
  }
}

// ─── Zip helpers ─────────────────────────────────────────────────────

/**
 * Zip a directory's contents (not the directory itself) to the given
 * output file.  `filter(entryPath, stats)` can return false to exclude
 * a file; it receives paths relative to `srcDir`.
 * `overrides` is an optional map of relative path → Buffer|string that
 * replaces the content of that file in the archive (the file on disk is
 * skipped; the override is added instead). Used to strip the `key` field
 * from manifest.json for the Chrome Web Store zip without needing a
 * staging directory on disk.
 */
function zipDir(srcDir, outFile, filter = () => true, overrides = {}) {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve(archive.pointer()));
    archive.on('error', reject);
    archive.on('warning', (w) => { if (w.code !== 'ENOENT') reject(w); });
    archive.pipe(out);

    const overrideKeys = new Set(Object.keys(overrides));
    const walk = (abs, rel) => {
      const entries = readdirSync(abs);
      for (const name of entries) {
        const absPath = path.join(abs, name);
        const relPath = rel ? path.join(rel, name).replace(/\\/g, '/') : name;
        const stats = statSync(absPath);
        if (!filter(relPath, stats)) continue;
        if (stats.isDirectory()) {
          walk(absPath, relPath);
        } else if (overrideKeys.has(relPath)) {
          // Override: use the provided content instead of the file on disk.
          archive.append(overrides[relPath], { name: relPath });
          overrideKeys.delete(relPath);
        } else {
          archive.file(absPath, { name: relPath });
        }
      }
    };
    walk(srcDir, '');
    // Any overrides that didn't match an on-disk file get added as new
    // entries (rare, but supports future use cases).
    for (const extra of overrideKeys) {
      archive.append(overrides[extra], { name: extra });
    }
    archive.finalize();
  });
}

/** Exclusion filter for browser-extension dist zips. Drops stale chunks,
 *  stray manifest templates, and the src/ leak from vite's publicDir. */
function buildExtensionFilter(liveChunkHashes) {
  return (relPath) => {
    // Drop the stray template files auto-copied from public/.
    if (relPath === 'manifest.chrome.json' || relPath === 'manifest.firefox.json') return false;
    // Drop the src/ directory leak (the HTML flatten step couldn't unlink
    // it on restricted filesystems; on Windows it's harmless but still junk).
    if (relPath === 'src' || relPath.startsWith('src/')) return false;
    // Drop any test/junk files.
    if (relPath === 'manifest.json.tmp') return false;
    // Drop stale hashed chunks — only keep the ones actually referenced
    // by the current entry files.
    const chunkMatch = relPath.match(/^chunks\/(AuthPopup|MessageHandler)-([A-Za-z0-9_-]+)\.js$/);
    if (chunkMatch) {
      const hash = chunkMatch[2];
      if (!liveChunkHashes.has(hash)) return false;
    }
    return true;
  };
}

/** Scan a dist folder's entry files for the chunk hashes they reference. */
function findLiveChunkHashes(distDir) {
  const entryFiles = ['background.js', 'newtab.js', 'newtab.html', 'popup.js', 'popup.html', 'sidebar.js', 'sidebar.html'];
  const hashes = new Set();
  const re = /(?:AuthPopup|MessageHandler)-([A-Za-z0-9_-]+)\.js/g;
  for (const f of entryFiles) {
    const p = path.join(distDir, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) hashes.add(m[1]);
  }
  return hashes;
}

// ─── 1. Chrome dev zip (with key) ────────────────────────────────────
{
  const liveHashes = findLiveChunkHashes(chromeDist);
  const outFile = path.join(root, `tabflow-chrome-${version}.zip`);
  const size = await zipDir(chromeDist, outFile, buildExtensionFilter(liveHashes));
  console.log(`  ✓ tabflow-chrome-${version}.zip  (${Math.round(size/1024)} KB, dev build with key)`);
}

// ─── 2. Chrome store zip (no key) ────────────────────────────────────
// Same contents as the dev zip, except manifest.json has the `key` field
// stripped. Achieved via an in-memory override — no staging directory —
// so there's no risk of stale files from a previous run leaking into the
// archive.
{
  const liveHashes = findLiveChunkHashes(chromeDist);
  const manifestOnDisk = JSON.parse(readFileSync(path.join(chromeDist, 'manifest.json'), 'utf8'));
  delete manifestOnDisk.key;
  const overrides = {
    'manifest.json': Buffer.from(JSON.stringify(manifestOnDisk, null, 2), 'utf8'),
  };
  const outFile = path.join(root, `tabflow-chrome-${version}-store.zip`);
  const size = await zipDir(chromeDist, outFile, buildExtensionFilter(liveHashes), overrides);
  console.log(`  ✓ tabflow-chrome-${version}-store.zip  (${Math.round(size/1024)} KB, Chrome Web Store upload)`);
}

// ─── 3. Firefox zip ──────────────────────────────────────────────────
{
  const liveHashes = findLiveChunkHashes(firefoxDist);
  const outFile = path.join(root, `tabflow-firefox-${version}.zip`);
  const size = await zipDir(firefoxDist, outFile, buildExtensionFilter(liveHashes));
  console.log(`  ✓ tabflow-firefox-${version}.zip  (${Math.round(size/1024)} KB, AMO upload)`);
}

// ─── 4. Source zip (for AMO's source-code requirement) ───────────────
// Ships the repo minus node_modules / dist / .git / build artifacts /
// old release zips / sandbox temp files. Includes BUILD_FROM_SOURCE.md
// at the root with build instructions for reviewers.
{
  const outFile = path.join(root, `tabflow-source-${version}.zip`);
  const excluded = new Set([
    'node_modules', 'dist', '.git', '.release-tmp-chrome-store',
    '.vscode', '.idea', '.DS_Store',
    'bin', 'obj', // .NET build output
  ]);
  const sourceFilter = (relPath) => {
    const parts = relPath.split('/');
    // Skip anywhere along the path
    for (const p of parts) if (excluded.has(p)) return false;
    // Skip sandbox-leaked zip temp files (zi<hex>) in the project root
    if (parts.length === 1 && /^zi[A-Za-z0-9]+$/.test(parts[0])) return false;
    // Skip release zips themselves (don't pack zips inside the source zip)
    if (parts.length === 1 && /^tabflow-.*\.zip$/.test(parts[0])) return false;
    // Skip vite.config.ts.timestamp-*.mjs (created by vite during build,
    // sometimes left behind)
    if (parts[parts.length - 1].startsWith('vite.config.ts.timestamp-')) return false;
    // Skip TS build info cache
    if (parts[parts.length - 1].endsWith('.tsbuildinfo')) return false;
    // Skip the archive itself if we're re-running
    if (parts.length === 1 && parts[0].startsWith('tabflow-source-')) return false;
    // Skip the Archive/ folder (old version zips — kept locally, not shipped)
    if (parts[0] === 'Archive') return false;
    return true;
  };
  const size = await zipDir(root, outFile, sourceFilter);
  console.log(`  ✓ tabflow-source-${version}.zip  (${Math.round(size/1024)} KB, AMO source upload)`);
}

// ─── 5. Move older-version zips into Archive/ ─────────────────────────
// Keep only the current version's zips in the project root — everything
// else gets moved into Archive/. Makes it easier to find the current
// zips when uploading to Chrome Web Store / AMO. Archive/ is excluded
// from the source zip so it doesn't bloat AMO uploads.
{
  const { mkdirSync, renameSync } = require('fs');
  const archiveDir = path.join(root, 'Archive');
  try {
    mkdirSync(archiveDir, { recursive: true });
  } catch { /* already exists */ }

  const rootFiles = readdirSync(root);
  let moved = 0;
  for (const name of rootFiles) {
    if (!name.startsWith('tabflow-')) continue;
    if (!name.endsWith('.zip')) continue;
    // Keep the current version's zips in the root
    if (name.includes(`-${version}.`) || name.includes(`-${version}-store.`)) continue;
    try {
      renameSync(path.join(root, name), path.join(archiveDir, name));
      moved++;
    } catch (err) {
      console.warn(`[release] Could not move ${name} to Archive/: ${err.message}`);
    }
  }
  if (moved > 0) {
    console.log(`\n[release] Archived ${moved} older-version zip(s) into Archive/`);
  }
}

console.log(`\n[release] Done. Current version's zips are at the project root.`);
console.log(`[release] Upload order:`);
console.log(`    Chrome Web Store  → tabflow-chrome-${version}-store.zip`);
console.log(`    Firefox (AMO)     → tabflow-firefox-${version}.zip`);
console.log(`    Firefox source    → tabflow-source-${version}.zip`);
console.log();
