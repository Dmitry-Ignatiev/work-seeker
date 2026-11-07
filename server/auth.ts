import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { db } from './db';
import { authOptions } from './auth-options';

const google = authOptions.google
  ? { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! }
  : undefined;
const github = authOptions.github
  ? { clientId: process.env.GITHUB_CLIENT_ID!, clientSecret: process.env.GITHUB_CLIENT_SECRET! }
  : undefined;

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  // Production signs in with OAuth only: email flows would need a paid sending domain.
  emailAndPassword: { enabled: authOptions.emailPassword, minPasswordLength: 10 },
  socialProviders: { ...(google && { google }), ...(github && { github }) },
  // E2E creates many accounts from one IP within seconds; real traffic is always rate limited.
  rateLimit: { enabled: process.env.E2E !== '1' },
  // Must be last: lets Server Actions set auth cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
