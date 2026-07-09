# TabFlow — Build from source

This file explains how to reproduce the signed build you're reviewing from
the accompanying source tree. TabFlow is built with Vite; production
JavaScript is minified by Vite's default esbuild-based minifier.

## Environment

- **Node.js:** 20.x LTS or newer (the repo's `package.json` sets
  `"engines": { "node": ">=20.0.0" }`)
- **npm:** bundled with Node 20 (v10.x or newer)
- **Operating system:** build has been verified on Windows 10/11,
  macOS 14, and Ubuntu 22.04 — the toolchain is pure JavaScript and
  should work on any platform Node 20 supports

No Java, no Rust, no system libraries required for the browser extension.
(The optional native-messaging host in `packages/native-host/` is a
separate .NET project used only for Windows-side window-hiding and
memory stats; it is **not** required to build or run the extension.)

## Build steps

```bash
# 1. Install dependencies (pulls devDependencies only; no native modules)
npm install

# 2. Build both browser targets. Produces:
#      packages/browser-extension/dist/chrome/    (Chrome/Chromium)
#      packages/browser-extension/dist/firefox/   (Firefox)
npm run build
```

The Firefox bundle that matches the submitted version lives at
`packages/browser-extension/dist/firefox/` after the build. Contents:

- `manifest.json` — Firefox MV3 manifest (copied from
  `public/manifest.firefox.json` by the Vite post-build plugin)
- `background.js` — service worker entry (source:
  `src/background/service-worker.ts` and everything it imports)
- `newtab.html` / `newtab.js` — new-tab page UI
- `popup.html` / `popup.js` — toolbar popup
- `sidebar.html` / `sidebar.js` — sidebar placeholder
- `scroll-tracker.js` — cross-device scroll-sync content script
  (source: `src/content/scroll-tracker.ts`)
- `youtube-time-tracker.js` — YouTube-specific content script
- `suspended.html` / `suspended.js` — "click-to-reload" page used by
  the workspace-restore feature (content identical in source)
- `chunks/` — code-split JavaScript chunks emitted by Rollup
- `icons/` — extension icons

To repackage for AMO:

```bash
npm run package
```

This produces `tabflow-firefox-<VERSION>.zip` at the repo root and is
identical to what gets uploaded to addons.mozilla.org. (The script also
produces Chrome Web Store and source zips — see
`scripts/package-release.mjs`.)

## Source layout

- `packages/browser-extension/` — the WebExtension itself
  - `public/` — static assets (manifests, icons, suspended page)
  - `src/` — TypeScript/TSX source
    - `background/` — service worker and tab-management logic
    - `newtab/` — new-tab page React UI
    - `popup/` — toolbar popup UI
    - `auth/` — onboarding and passphrase-based encryption key setup
    - `sync/` — Supabase sync client
    - `storage/` — IndexedDB adapter (Dexie.js)
    - `content/` — content scripts
    - `browser-compat.ts` — small Chrome/Firefox compatibility shim
    - `utils/` — shared utilities
- `packages/core/` — platform-agnostic types, the workspace engine,
  and the WebCrypto AES-GCM encryption wrapper (shared between the
  extension and any future native app)
- `packages/native-host/` — optional .NET native-messaging host
  (Windows only, used for window-hiding and process memory)
- `packages/supabase/` — SQL migrations for self-hosted Supabase
  backends (the extension stores only encrypted data in Supabase;
  see `packages/core/src/crypto/encryption.ts`)

## Verification tips

- `packages/browser-extension/vite.config.ts` is the entire build
  configuration. No custom minifier, no post-bundle obfuscation —
  Vite's default esbuild minify is used.
- `npm run typecheck` runs `tsc --noEmit` against both packages and
  will report any unsound TypeScript.
- Source maps are not emitted for the production build (keeps the
  shipped bundle small) but can be enabled by setting
  `build.sourcemap: true` in `vite.config.ts` and rebuilding; the
  output file structure and runtime behavior are otherwise identical.

## Contact

If reviewers need clarification on any source file or build step, please
contact the developer via the AMO developer dashboard.
