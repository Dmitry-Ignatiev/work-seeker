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
    // Migrations need a direct connection. Neon (Vercel Marketplace) provides DATABASE_URL_UNPOOLED for that;
    // the app itself uses the pooled DATABASE_URL. Locally there is only DATABASE_URL.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
    // `prisma migrate dev` needs a scratch database. Local `prisma dev` servers expose one
    // (see `npx prisma dev ls`); hosted Postgres can omit this and let Prisma create one.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
