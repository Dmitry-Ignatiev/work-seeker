import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

/**
 * The local `prisma dev` Postgres mixes up concurrent queries on several connections
 * ("bind message supplies N parameters…"), so local databases get a single connection.
 * Hosted Postgres (Neon) uses the normal pool.
 */
function isLocalDatabase(connectionString: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname);
  } catch {
    return false;
  }
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const pool = isLocalDatabase(connectionString) ? { connectionString, max: 1 } : { connectionString };
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
