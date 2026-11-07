/**
 * Admin: a one-time password reset link for a user who lost both password and recovery code.
 *   npm run reset-link -- someone@example.com                      (local database, .env.local)
 *   npm run reset-link -- someone@example.com --env .env.production.local --url https://work-seeker-sigma.vercel.app
 * For the live site, pull production env first (vercel env pull .env.production.local --environment=production)
 * and delete that file afterwards. Vercel never reveals "Sensitive" values (it writes "[SENSITIVE]"), which
 * is why the site address is passed with --url. See README → "Accounts and password recovery".
 * Check who is asking before you send the link: whoever opens it can set the password.
 */
import { config } from 'dotenv';

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const isPlaceholder = (value: string | undefined) => !value || value.includes('[SENSITIVE]');

config({ path: [option('--env') ?? process.env.RESET_ENV_FILE ?? '.env.local', '.env'], quiet: true });

const email = process.argv[2];
if (!email || !email.includes('@')) {
  console.error('Usage: npm run reset-link -- someone@example.com [--env <file>] [--url <site address>]');
  process.exit(1);
}
if (isPlaceholder(process.env.DATABASE_URL)) {
  console.error('DATABASE_URL is missing or a Vercel "[SENSITIVE]" placeholder; the script cannot reach the database.');
  process.exit(1);
}
const baseUrl = option('--url') ?? (isPlaceholder(process.env.BETTER_AUTH_URL) ? undefined : process.env.BETTER_AUTH_URL);
if (!baseUrl) {
  console.error(
    'The site address is unknown (BETTER_AUTH_URL is missing or a Vercel "[SENSITIVE]" placeholder).\n' +
      'Pass it: --url https://work-seeker-sigma.vercel.app',
  );
  process.exit(1);
}
try {
  new URL(baseUrl);
} catch {
  console.error(`Not a valid site address: ${baseUrl}`);
  process.exit(1);
}
// Better Auth reads BETTER_AUTH_URL when it starts: give it the real address, not a placeholder.
process.env.BETTER_AUTH_URL = baseUrl;

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
