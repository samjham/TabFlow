import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { existsSync, cpSync, rmSync, renameSync } from 'fs';

/**
 * Vite plugin that flattens nested HTML outputs to dist root
 * so manifest.json can reference popup.html and sidebar.html directly.
 */
function flattenHtml() {
  return {
    name: 'flatten-html',
    closeBundle() {
      const dist = path.resolve(__dirname, 'dist');
      const nested = path.join(dist, 'src', 'entries');
      if (existsSync(nested)) {
        for (const file of ['popup.html', 'sidebar.html', 'newtab.html']) {
          const src = path.join(nested, file);
          const dest = path.join(dist, file);
          if (existsSync(src)) {
            cpSync(src, dest);
          }
        }
        // Clean up nested dirs
        rmSync(path.join(dist, 'src'), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), flattenHtml()],
  build: {
    outDir: 'dist',
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
