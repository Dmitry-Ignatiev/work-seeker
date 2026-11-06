/**
 * Which sign-in methods are on. Safe to import from pages (no secrets exported).
 * Email+password exists only for local development and E2E tests.
 */
export const authOptions = {
  emailPassword: process.env.NODE_ENV !== 'production' || process.env.E2E === '1',
  google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
};
