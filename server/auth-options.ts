/**
 * Which sign-in methods are on. Safe to import from pages (no secrets exported).
 * Email + password is always on: it's the main way in. Google and GitHub are added when their keys are set.
 */
export const authOptions = {
  emailPassword: true,
  google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
};
