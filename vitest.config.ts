import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Lazy per-island tables (src/render2d/islandTable.ts) loaded up front for the sync getters.
    setupFiles: ['tests/setup/islandTables.ts'],
  },
});
