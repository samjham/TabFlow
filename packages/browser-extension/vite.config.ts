import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { existsSync, cpSync, rmSync } from 'fs';

/**
 * Build target — selected via the TARGET env var. Defaults to 'chrome'.
 * Each target gets its own dist/<target>/ output and its own manifest
 * (public/manifest.<target>.json is copied in as manifest.json during build).
 */
type BuildTarget = 'chrome' | 'firefox';
const TARGET: BuildTarget = (process.env.TARGET as BuildTarget) || 'chrome';
if (TARGET !== 'chrome' && TARGET !== 'firefox') {
  throw new Error(`Unknown TARGET "${TARGET}". Expected "chrome" or "firefox".`);
}

/**
 * Vite plugin that:
 * 1. Flattens nested HTML outputs to dist root (so the manifest can reference
 *    popup.html/sidebar.html/newtab.html directly).
 * 2. Copies the per-target manifest template into the output as manifest.json.
 */
function postBuild(target: BuildTarget, outDir: string) {
  return {
    name: 'tabflow-post-build',
    closeBundle() {
      const dist = path.resolve(__dirname, outDir);

      // 1. Flatten HTML outputs
      const nested = path.join(dist, 'src', 'entries');
      if (existsSync(nested)) {
        for (const file of ['popup.html', 'sidebar.html', 'newtab.html']) {
          const src = path.join(nested, file);
          const dest = path.join(dist, file);
          if (existsSync(src)) {
            cpSync(src, dest);
          }
        }
        rmSync(path.join(dist, 'src'), { recursive: true, force: true });
      }

      // 2. Copy the target's manifest in as manifest.json
      const manifestSrc = path.resolve(__dirname, 'public', `manifest.${target}.json`);
      const manifestDest = path.join(dist, 'manifest.json');
      if (existsSync(manifestSrc)) {
        cpSync(manifestSrc, manifestDest);
      } else {
        throw new Error(`Missing manifest template: ${manifestSrc}`);
      }

      // 3. Delete the other target's manifest template that Vite auto-copied
      //    from public/ so we don't ship both to the browser.
      for (const t of ['chrome', 'firefox'] as const) {
        const stray = path.join(dist, `manifest.${t}.json`);
        if (existsSync(stray)) rmSync(stray, { force: true });
      }
    },
  };
}

const outDir = `dist/${TARGET}`;

export default defineConfig({
  plugins: [react(), postBuild(TARGET, outDir)],
  // Expose the build target to source code (useful for the browser-compat shim).
  define: {
    'import.meta.env.TARGET_BROWSER': JSON.stringify(TARGET),
  },
  // Keep publicDir enabled so icons/ and suspended.html/.js get copied into
  // the output. The post-build plugin strips the stray manifest.<target>.json
  // templates out of the final dist so users don't see them.
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/entries/popup.html'),
        sidebar: path.resolve(__dirname, 'src/entries/sidebar.html'),
        newtab: path.resolve(__dirname, 'src/entries/newtab.html'),
        background: path.resolve(__dirname, 'src/background/service-worker.ts'),
        'youtube-time-tracker': path.resolve(__dirname, 'src/content/youtube-time-tracker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@tabflow/core': path.resolve(__dirname, '../core/src'),
      '@core': path.resolve(__dirname, '../core/src'),
    },
  },
});
