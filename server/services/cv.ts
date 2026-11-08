import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { parseStoredLayout, type CvLayout } from '@/server/cv/layout';
import type { CvLink } from '@/server/cv/links';
import { db } from '@/server/db';
import { isUniqueViolation, NotFoundError } from '@/server/errors';
import type { CvFileFormat } from '@/server/download';
import { scanSkills } from '@/server/matching/cv-skills';
import { plainTextLayout } from '@/server/tailor/fallback-layout';
import { buildLayoutDocx } from '@/server/tailor/layout-docx';
import { buildLayoutPdf } from '@/server/tailor/layout-pdf';

export interface CvSummary {
  id: string;
  label: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  isDefault: boolean;
  createdAt: Date;
  /** Why the PDF's layout couldn't be kept (MULTI_COLUMN, RTL), if it couldn't. */
  layoutNote: string | null;
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
  /** Page layout read from the PDF (server/cv/layout.ts), and why it's missing when it is. */
  layout?: CvLayout | null;
  layoutNote?: string;
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
      layoutNote: true,
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
  const layout = input.layout ? (input.layout as unknown as Prisma.InputJsonValue) : undefined;
  const layoutNote = input.layoutNote ?? null;
  const existing = await findExisting();
  if (existing) {
    // Same text uploaded again: refresh what's read from the file (CVs uploaded earlier had no links or layout).
    if (links || layout || input.layoutNote) {
      await db.cv.update({ where: { id: existing.id }, data: { ...(links && { links }), ...(layout && { layout }), layoutNote } });
    }
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
          layout,
          layoutNote,
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

/**
 * An uploaded CV as a file, with no AI and no edits: DOCX converts it, PDF gives a PDF back. Both are rebuilt
 * from the layout read at upload (the original file is never stored), or from its text when there's none.
 */
export async function renderUploadedCv(
  userId: string,
  cvId: string,
  format: CvFileFormat,
): Promise<{ buffer: Buffer; fileName: string; usedLayout: boolean }> {
  const cv = await db.cv.findFirst({ where: { id: cvId, userId }, select: { label: true, textContent: true, layout: true } });
  if (!cv) throw new NotFoundError('CV');
  const stored = parseStoredLayout(cv.layout);
  const layout = stored ?? plainTextLayout(cv.textContent);
  const { buffer } =
    format === 'pdf' ? await buildLayoutPdf({ layout, edits: [], title: cv.label }) : await buildLayoutDocx({ layout, edits: [] });
  return { buffer, fileName: cv.label, usedLayout: stored !== null };
}
