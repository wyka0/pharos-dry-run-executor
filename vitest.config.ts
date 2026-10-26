import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Live network tests (tests/live.pharos.test.ts) are skipped unless
    // RUN_LIVE_TESTS=1 is set. `npm test` must never depend on network access.
    reporters: ['default'],
  },
});
