import { inject } from 'vitest';

// Runs before each test file's imports, so server/db.ts connects to the test database.
process.env.DATABASE_URL = inject('testDatabaseUrl');
process.env.AI_MOCK = '1';
