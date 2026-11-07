import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import type { CvLink } from '@/server/cv/links';
import { db } from '@/server/db';
import { isUniqueViolation, NotFoundError } from '@/server/errors';
import { scanSkills } from '@/server/matching/cv-skills';

export interface CvSummary {
  id: string;
  label: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  isDefault: boolean;
  createdAt: Date;
  /** Canonical skill names found in the text, most mentioned first. */
  skills: string[];
}

export interface NewCv {
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  text: string;
  /** Links read from the PDF (server/cv/links.ts). */
  links?: CvLink[];
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** "C:\\fakepath\\Dana Levi CV.pdf" → file "Dana Levi CV.pdf", label "Dana Levi CV". */
export function namesFromUpload(rawName: string): { fileName: string; label: string } {
  const base = rawName.split(/[\\/]/).pop()?.trim() || 'cv.pdf';
  const fileName = base.slice(0, 200);
  const label = fileName.replace(/\.pdf$/i, '').trim().slice(0, 80) || 'My CV';
  return { fileName, label };
}

export async function listCvs(userId: string): Promise<CvSummary[]> {
  const rows = await db.cv.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      label: true,
      fileName: true,
      sizeBytes: true,
      pageCount: true,
      isDefault: true,
      createdAt: true,
      skills: {
        select: { skill: { select: { canonicalName: true } } },
        orderBy: [{ mentions: 'desc' }, { skill: { canonicalName: 'asc' } }],
      },
    },
  });
  return rows.map(({ skills, ...cv }) => ({ ...cv, skills: skills.map(s => s.skill.canonicalName) }));
}

export async function countCvs(userId: string): Promise<number> {
  return db.cv.count({ where: { userId } });
}

/**
 * Stores a parsed CV's text and its skill mentions. The first CV becomes the default.
 * Uploading the same text again returns the existing CV instead of a copy.
 */
export async function createCv(userId: string, input: NewCv): Promise<{ id: string; duplicate: boolean }> {
  const contentHash = sha256(input.text);
  const findExisting = () =>
    db.cv.findUnique({ where: { userId_contentHash: { userId, contentHash } }, select: { id: true } });

  const links = input.links?.length ? (input.links as unknown as Prisma.InputJsonValue) : undefined;
  const existing = await findExisting();
  if (existing) {
    // Same text uploaded again: refresh its links (CVs uploaded before links were read had none).
    if (links) await db.cv.update({ where: { id: existing.id }, data: { links } });
    return { id: existing.id, duplicate: true };
  }

  const aliases = await db.skillAlias.findMany({ where: { textScan: true }, select: { alias: true, skillId: true } });
  const mentions = scanSkills(input.text, aliases);
  const { fileName, label } = namesFromUpload(input.fileName);

  try {
    return await db.$transaction(async tx => {
      const hasDefault = (await tx.cv.count({ where: { userId, isDefault: true } })) > 0;
      const cv = await tx.cv.create({
        data: {
          userId,
          label,
          fileName,
          sizeBytes: input.sizeBytes,
          pageCount: input.pageCount,
          contentHash,
          textContent: input.text,
          links,
          status: 'PARSED',
          isDefault: !hasDefault,
        },
        select: { id: true },
      });
      if (mentions.size > 0) {
        await tx.cvSkill.createMany({
          data: [...mentions].map(([skillId, count]) => ({ cvId: cv.id, skillId, mentions: count })),
        });
      }
      return { id: cv.id, duplicate: false };
    });
  } catch (error) {
    // The same file uploaded twice at once: the second insert loses the race.
    if (isUniqueViolation(error)) {
      const winner = await findExisting();
      if (winner) return { id: winner.id, duplicate: true };
    }
    throw error;
  }
}

async function findOwnedCv(tx: Pick<typeof db, 'cv'>, userId: string, cvId: string) {
  const cv = await tx.cv.findFirst({ where: { id: cvId, userId }, select: { id: true, isDefault: true } });
  if (!cv) throw new NotFoundError('CV');
  return cv;
}

export async function setDefaultCv(userId: string, cvId: string): Promise<void> {
  await db.$transaction(async tx => {
    await findOwnedCv(tx, userId, cvId);
    await tx.cv.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    await tx.cv.update({ where: { id: cvId }, data: { isDefault: true } });
  });
}

/** Deletes the CV's row (its text and skills). If it was the default, the newest remaining CV takes over. */
export async function deleteCv(userId: string, cvId: string): Promise<void> {
  await db.$transaction(async tx => {
    const cv = await findOwnedCv(tx, userId, cvId);
    await tx.cv.delete({ where: { id: cv.id } });
    if (cv.isDefault) {
      const next = await tx.cv.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      if (next) await tx.cv.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}
