'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { NotFoundError } from '@/server/errors';
import { deleteCv, setDefaultCv } from '@/server/services/cv';
import { requireUser } from '@/server/session';

export type ActionResult = { ok: true } | { ok: false; message: string };

const cvId = z.string().min(1).max(100);

async function onCv(rawId: unknown, change: (userId: string, id: string) => Promise<void>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = cvId.safeParse(rawId);
  if (!parsed.success) return { ok: false, message: 'Invalid CV.' };
  try {
    await change(user.id, parsed.data);
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, message: 'That CV no longer exists.' };
    throw error;
  }
  refresh();
  return { ok: true };
}

export async function setDefaultCvAction(id: string): Promise<ActionResult> {
  return onCv(id, setDefaultCv);
}

export async function deleteCvAction(id: string): Promise<ActionResult> {
  return onCv(id, deleteCv);
}
