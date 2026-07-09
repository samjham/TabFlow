import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['**/message-handler.test.ts'],
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@tabflow/core': path.resolve(__dirname, '../../core/src'),
    },
  },
});
