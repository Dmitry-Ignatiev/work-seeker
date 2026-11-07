/**
 * Admin: a one-time password reset link for a user who lost both password and recovery code.
 *   npm run reset-link -- someone@example.com
 * Uses DATABASE_URL and BETTER_AUTH_URL from .env.local. For the live site, first pull production
 * env into a file and point at it:  vercel env pull .env.production.local --environment=production
 *   RESET_ENV_FILE=.env.production.local npm run reset-link -- someone@example.com
 * Check who is asking before you send the link: whoever opens it can set the password.
 */
import { config } from 'dotenv';

config({ path: [process.env.RESET_ENV_FILE ?? '.env.local', '.env'], quiet: true });

const email = process.argv[2];
if (!email || !email.includes('@')) {
  console.error('Usage: npm run reset-link -- someone@example.com');
  process.exit(1);
}
const baseUrl = process.env.BETTER_AUTH_URL;
if (!baseUrl) {
  console.error('BETTER_AUTH_URL is not set (the site address the link should open).');
  process.exit(1);
}

// Imported after the env is loaded: the database client reads DATABASE_URL when it is created.
const { createAdminResetLink, ADMIN_LINK_MINUTES } = await import('../server/services/recovery');
const { db } = await import('../server/db');

try {
  const link = await createAdminResetLink(email, baseUrl);
  if (!link) {
    console.error(`No account uses ${email}.`);
    process.exitCode = 1;
  } else {
    console.log(`One-time reset link for ${email} (valid ${ADMIN_LINK_MINUTES} minutes):\n\n${link}\n`);
  }
} finally {
  await db.$disconnect();
}
