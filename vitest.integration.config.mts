import { defineConfig } from 'vitest/config';
import { resolve } from './vitest.shared';

/** Integration tests: real Postgres (TEST_DATABASE_URL), mocked AI, one file at a time. */
export default defineConfig({
  resolve,
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/support/integration-global-setup.ts'],
    setupFiles: ['tests/support/integration-env.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
