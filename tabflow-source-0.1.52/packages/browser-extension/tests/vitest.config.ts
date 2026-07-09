import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Smoke tests are slow (browser startup, tab operations)
    testTimeout: 60_000,
    hookTimeout: 30_000,

    // Run tests sequentially — they share one browser instance
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },

    // Only run files in this directory
    include: ['**/*.test.ts'],
  },
});
