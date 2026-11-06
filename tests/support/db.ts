import { randomUUID } from 'node:crypto';
import { db } from '@/server/db';

/** Empties every application table (keeps the migrations table). Test database only. */
export async function resetDatabase(): Promise<void> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map(t => `"public"."${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function createTestUser(overrides: { name?: string; email?: string } = {}) {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      name: overrides.name ?? 'Test User',
      email: overrides.email ?? `user-${id}@example.test`,
    },
  });
}
