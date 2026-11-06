import { execSync } from 'node:child_process';
import { config } from 'dotenv';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

/** Applies migrations to the dedicated test database, then hands its URL to the workers. */
export default function setup(project: TestProject) {
  config({ path: ['.env.local', '.env'], quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Locally: `npm run db:dev:test` and add its URL to .env.local. ' +
        'Never point it at a database whose data you need: tests truncate every table.',
    );
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL: tests truncate every table.');
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
  project.provide('testDatabaseUrl', url);
}
