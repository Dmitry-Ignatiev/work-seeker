import { defineConfig } from 'vitest/config';
import { resolve } from './vitest.shared';

/** Unit tests: pure modules, no database, mocked AI. */
export default defineConfig({
  resolve,
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/support/setup.ts'],
  },
});
