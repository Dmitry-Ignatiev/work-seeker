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

const RESET_LINK_MINUTES = 60;

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  // Email + password is the main way in. No email is sent: a forgotten password is reset with the
  // user's recovery code (server/services/recovery.ts) or an admin link (scripts/reset-link.mts),
  // both through Better Auth's reset endpoint.
  emailAndPassword: {
    enabled: authOptions.emailPassword,
    minPasswordLength: 10,
    resetPasswordTokenExpiresIn: RESET_LINK_MINUTES * 60,
    // A reset signs out every device, in case the old password was stolen.
    revokeSessionsOnPasswordReset: true,
  },
  socialProviders: { ...(google && { google }), ...(github && { github }) },
  // E2E creates many accounts from one IP within seconds; real traffic is always rate limited.
  rateLimit: { enabled: process.env.E2E !== '1' },
  // Must be last: lets Server Actions set auth cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
