'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { allow, clientIp } from '@/server/rate-limit';
import {
  issueRecoveryCode,
  PASSWORD_MAX,
  PASSWORD_MIN,
  resetPasswordWithRecoveryCode,
} from '@/server/services/recovery';
import { requireUser } from '@/server/session';

export type CreateCodeResult = { ok: true; code: string } | { ok: false; message: string };
export type ResetResult = { ok: true; newCode: string } | { ok: false; message: string };

const WINDOW_MS = 15 * 60_000;

/** Signed in: create or replace your recovery code. */
export async function createRecoveryCodeAction(): Promise<CreateCodeResult> {
  const user = await requireUser();
  if (!allow(`recovery-issue:${user.id}`, 10, WINDOW_MS)) {
    return { ok: false, message: 'Too many new codes in a short time. Try again later.' };
  }
  return { ok: true, code: await issueRecoveryCode(user.id) };
}

const resetInput = z.object({
  email: z.email().max(254),
  code: z.string().min(1).max(40),
  newPassword: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});

const NO_MATCH =
  "That email and recovery code don't match. After 5 wrong tries a code is locked for 15 minutes.";

/** Signed out: reset a forgotten password with email + recovery code. */
export async function resetWithRecoveryCodeAction(raw: unknown): Promise<ResetResult> {
  const parsed = resetInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: `Check the form: the new password needs ${PASSWORD_MIN}–${PASSWORD_MAX} characters.` };
  }
  if (process.env.E2E !== '1' && !allow(`recovery-reset:${clientIp(await headers())}`, 10, WINDOW_MS)) {
    return { ok: false, message: 'Too many attempts from your network. Wait 15 minutes and try again.' };
  }
  const result = await resetPasswordWithRecoveryCode(parsed.data);
  return result.ok ? result : { ok: false, message: NO_MATCH };
}
