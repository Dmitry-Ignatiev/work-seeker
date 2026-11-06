import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Next.js reads .env.local; load it for the Prisma CLI too.
config({ path: ['.env.local', '.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
    // `prisma migrate dev` needs a scratch database. Local `prisma dev` servers expose one
    // (see `npx prisma dev ls`); hosted Postgres can omit this and let Prisma create one.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
