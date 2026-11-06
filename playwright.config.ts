import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: ['.env.local', '.env'], quiet: true });

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;
// E2E writes users and data, so it runs against the test database, never the dev one.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for E2E tests (see .env.example).');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // Locally `next dev` compiles each route on its first visit, which can take longer than 5 s.
  expect: { timeout: process.env.CI ? 5_000 : 20_000 },
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // CI tests the production build. Locally the dev server starts faster
    // (stop any other `next dev` for this folder first: Next allows one per project).
    // The seed (skills taxonomy) is idempotent; integration tests truncate it, and CV skill scans need it.
    command: process.env.CI
      ? `npx prisma migrate deploy && npx prisma db seed && npm run build && npx next start -p ${PORT}`
      : `npx prisma migrate deploy && npx prisma db seed && npx next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      AI_MOCK: '1',
      E2E: '1',
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_URL: baseURL,
    },
  },
});
