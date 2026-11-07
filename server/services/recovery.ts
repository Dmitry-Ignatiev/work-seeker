import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { auth } from '@/server/auth';
import { db } from '@/server/db';
import {
  formatRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCode,
  sameHash,
} from '@/server/recovery/code';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** HMAC key derived from the auth secret (rotating that secret invalidates every recovery code). */
function hashKey(): string {
  const base = process.env.BETTER_AUTH_SECRET || 'local-development-only';
  return createHmac('sha256', base).update('work-seeker:recovery-code').digest('hex');
}

const hash = (code: string) => hashRecoveryCode(code, hashKey());

/** Compared against when there is no real code, so a missing account takes the same work. */
const DUMMY_HASH = '0'.repeat(64);

/** Creates (or replaces) the user's recovery code. Returns it once, formatted; only its hash is stored. */
export async function issueRecoveryCode(userId: string): Promise<string> {
  const code = generateRecoveryCode();
  const data = { codeHash: hash(code), failedAttempts: 0, lockedUntil: null };
  await db.recoveryCode.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  console.info(`[recovery] code issued for user ${userId}`);
  return formatRecoveryCode(code);
}

export async function hasRecoveryCode(userId: string): Promise<boolean> {
  return (await db.recoveryCode.count({ where: { userId } })) > 0;
}

export const ADMIN_LINK_MINUTES = 60;

/**
 * Admin fallback for a user who lost both password and recovery code: a one-time reset link,
 * valid for an hour, that the site owner sends them by hand. Null when no account has that email.
 */
export async function createAdminResetLink(email: string, baseUrl: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  if (!user) return null;
  const token = randomBytes(32).toString('base64url');
  const ctx = await auth.$context;
  await ctx.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: user.id,
    expiresAt: new Date(Date.now() + ADMIN_LINK_MINUTES * 60_000),
  });
  console.info(`[recovery] admin reset link created for user ${user.id}`);
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent('/reset-password')}`;
}

export type RecoveryResult ={ ok: true; newCode: string } | { ok: false };

/**
 * Resets a forgotten password with the recovery code (OWASP Forgot Password, "offline method").
 * Nothing about the account changes until the code is proven. Every failure looks the same,
 * whether the email is unknown, the code is wrong, or the code is locked after too many guesses.
 * On success the code is burned, a new one is returned, and every session is signed out.
 */
export async function resetPasswordWithRecoveryCode(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<RecoveryResult> {
  if (input.newPassword.length < PASSWORD_MIN || input.newPassword.length > PASSWORD_MAX) return { ok: false };

  const normalized = normalizeRecoveryCode(input.code);
  const candidate = hash(normalized ?? 'not-a-code');
  const user = await db.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
    select: { id: true, recoveryCode: true },
  });
  const record = user?.recoveryCode;
  const matches = sameHash(candidate, record?.codeHash ?? DUMMY_HASH) && normalized !== null;
  if (!user || !record) return { ok: false };

  const now = new Date();
  if (record.lockedUntil && record.lockedUntil > now) {
    console.warn(`[recovery] attempt on a locked code for user ${user.id}`);
    return { ok: false };
  }

  if (!matches) {
    const failed = record.failedAttempts + 1;
    const lock = failed >= MAX_FAILED_ATTEMPTS;
    await db.recoveryCode.update({
      where: { userId: user.id },
      data: lock
        ? { failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }
        : { failedAttempts: failed },
    });
    console.warn(`[recovery] wrong code for user ${user.id}${lock ? `, locked for ${LOCK_MINUTES} minutes` : ''}`);
    return { ok: false };
  }

  // Burn the code first, atomically: two requests with the same code can't both succeed.
  const newCode = generateRecoveryCode();
  const burned = await db.recoveryCode.updateMany({
    where: { userId: user.id, codeHash: record.codeHash },
    data: { codeHash: hash(newCode), failedAttempts: 0, lockedUntil: null },
  });
  if (burned.count !== 1) return { ok: false };

  try {
    // Hand over to Better Auth's own reset: it hashes the password, creates the password login if the
    // account only had Google/GitHub, and signs out every session (revokeSessionsOnPasswordReset).
    const token = randomBytes(32).toString('base64url');
    const ctx = await auth.$context;
    await ctx.internalAdapter.createVerificationValue({
      identifier: `reset-password:${token}`,
      value: user.id,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await auth.api.resetPassword({ body: { newPassword: input.newPassword, token } });
  } catch (error) {
    // Put the old code back so the user isn't left without one.
    await db.recoveryCode.update({ where: { userId: user.id }, data: { codeHash: record.codeHash } });
    console.error(`[recovery] password reset failed for user ${user.id}:`, error instanceof Error ? error.message : error);
    throw error;
  }

  console.info(`[recovery] password reset with recovery code for user ${user.id}`);
  return { ok: true, newCode: formatRecoveryCode(newCode) };
}
