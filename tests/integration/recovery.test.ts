import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '@/server/auth';
import { db } from '@/server/db';
import {
  createAdminResetLink,
  hasRecoveryCode,
  issueRecoveryCode,
  MAX_FAILED_ATTEMPTS,
  resetPasswordWithRecoveryCode,
} from '@/server/services/recovery';
import { resetDatabase } from '../support/db';

const OLD = 'old-password-123';
const NEW = 'new-password-456';

async function signUp(email: string) {
  const { user } = await auth.api.signUpEmail({ body: { email, password: OLD, name: 'Recovery Tester' } });
  return user;
}

async function canSignIn(email: string, password: string): Promise<boolean> {
  try {
    await auth.api.signInEmail({ body: { email, password } });
    return true;
  } catch {
    return false;
  }
}

describe('recovery codes', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('stores only a hash of the code', async () => {
    const user = await signUp('dana@example.test');
    expect(await hasRecoveryCode(user.id)).toBe(false);
    const code = await issueRecoveryCode(user.id);
    const row = await db.recoveryCode.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.codeHash).not.toContain(code.replaceAll('-', ''));
    expect(await hasRecoveryCode(user.id)).toBe(true);
  });

  it('resets the password with the right code, signs out every session, and burns the code', async () => {
    const user = await signUp('dana@example.test');
    const code = await issueRecoveryCode(user.id);
    expect(await db.session.count({ where: { userId: user.id } })).toBeGreaterThan(0);

    const result = await resetPasswordWithRecoveryCode({ email: 'Dana@Example.test', code, newPassword: NEW });
    expect(result.ok).toBe(true);
    expect(result.ok && result.newCode).not.toBe(code);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await canSignIn('dana@example.test', OLD)).toBe(false);
    expect(await canSignIn('dana@example.test', NEW)).toBe(true);

    const again = await resetPasswordWithRecoveryCode({ email: 'dana@example.test', code, newPassword: 'third-password-789' });
    expect(again.ok).toBe(false);
    expect(await canSignIn('dana@example.test', NEW)).toBe(true);
  });

  it('changes nothing for a wrong code, an unknown email, someone else’s code, or a too-short password', async () => {
    const dana = await signUp('dana@example.test');
    const omer = await signUp('omer@example.test');
    const danaCode = await issueRecoveryCode(dana.id);
    await issueRecoveryCode(omer.id);

    for (const attempt of [
      { email: 'dana@example.test', code: 'AAAA-BBBB-CCCC-DDDD', newPassword: NEW },
      { email: 'nobody@example.test', code: danaCode, newPassword: NEW },
      { email: 'omer@example.test', code: danaCode, newPassword: NEW },
      { email: 'dana@example.test', code: danaCode, newPassword: 'short' },
    ]) {
      expect((await resetPasswordWithRecoveryCode(attempt)).ok).toBe(false);
    }
    expect(await canSignIn('dana@example.test', OLD)).toBe(true);
    expect(await canSignIn('omer@example.test', OLD)).toBe(true);
  });

  it(`locks the code after ${MAX_FAILED_ATTEMPTS} wrong tries, even against the right code`, async () => {
    const user = await signUp('dana@example.test');
    const code = await issueRecoveryCode(user.id);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await resetPasswordWithRecoveryCode({ email: 'dana@example.test', code: 'AAAA-BBBB-CCCC-DDDD', newPassword: NEW });
    }
    const row = await db.recoveryCode.findUniqueOrThrow({ where: { userId: user.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    expect((await resetPasswordWithRecoveryCode({ email: 'dana@example.test', code, newPassword: NEW })).ok).toBe(false);
    expect(await canSignIn('dana@example.test', OLD)).toBe(true);

    // Once the lock expires, the right code works again.
    await db.recoveryCode.update({ where: { userId: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await resetPasswordWithRecoveryCode({ email: 'dana@example.test', code, newPassword: NEW })).ok).toBe(true);
  });

  it('a new code replaces the old one', async () => {
    const user = await signUp('dana@example.test');
    const first = await issueRecoveryCode(user.id);
    await issueRecoveryCode(user.id);
    expect((await resetPasswordWithRecoveryCode({ email: 'dana@example.test', code: first, newPassword: NEW })).ok).toBe(false);
  });

  it('admin reset links: one-time, and only for existing accounts', async () => {
    await signUp('dana@example.test');
    expect(await createAdminResetLink('nobody@example.test', 'http://localhost:3000')).toBeNull();

    const link = await createAdminResetLink('dana@example.test', 'http://localhost:3000/');
    expect(link).toMatch(/^http:\/\/localhost:3000\/api\/auth\/reset-password\/[\w-]+\?callbackURL=%2Freset-password$/);
    const token = new URL(link!).pathname.split('/').pop()!;

    await auth.api.resetPassword({ body: { newPassword: NEW, token } });
    expect(await canSignIn('dana@example.test', NEW)).toBe(true);
    await expect(auth.api.resetPassword({ body: { newPassword: 'third-password-789', token } })).rejects.toThrow();
  });
});
