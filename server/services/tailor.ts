import 'server-only';
import { redactPii } from '@/server/ai/redact';
import { extractJobKeywords, proposeTailoring, STRUCTURE_PROMPT_VERSION, structureCv, TAILOR_PROMPT_VERSION } from '@/server/ai/tailoring';
import { db } from '@/server/db';
import { NotFoundError } from '@/server/errors';
import { scanSkills } from '@/server/matching/cv-skills';
import { normalizeSkillName } from '@/server/matching/skills';
import { applyGuard, SUMMARY_ID } from '@/server/tailor/guard';
import { containsTerm, keywordKey } from '@/server/tailor/text-match';
import type { CvStructure, JobKeyword, TailorChange } from '@/server/tailor/types';
import { bulletCount, buildStructure, validateKeywords } from '@/server/tailor/validate';
import { loadFullJob } from './jobs';

// ───────────────────────── Skills taxonomy (synonyms + "which technologies does this text mention") ─────────────────────────

interface Taxonomy {
  synonyms: (term: string) => string[];
  skillsIn: (text: string) => Set<string>;
  ambiguous: (term: string) => boolean;
}

let taxonomyCache: { at: number; value: Taxonomy } | null = null;
const TAXONOMY_TTL_MS = 10 * 60 * 1000;

async function taxonomy(): Promise<Taxonomy> {
  if (taxonomyCache && Date.now() - taxonomyCache.at < TAXONOMY_TTL_MS) return taxonomyCache.value;
  const rows = await db.skillAlias.findMany({
    select: { alias: true, textScan: true, skillId: true, skill: { select: { canonicalName: true } } },
  });
  const skillOf = new Map<string, string>();
  const aliasesOf = new Map<string, string[]>();
  const nameOf = new Map<string, string>();
  const ambiguousAliases = new Set<string>();
  for (const row of rows) {
    skillOf.set(row.alias, row.skillId);
    nameOf.set(row.skillId, row.skill.canonicalName);
    if (row.textScan) aliasesOf.set(row.skillId, [...(aliasesOf.get(row.skillId) ?? []), row.alias]);
    else ambiguousAliases.add(row.alias);
  }
  const scanList = rows.filter(r => r.textScan).map(r => ({ alias: r.alias, skillId: r.skillId }));
  const value: Taxonomy = {
    synonyms: term => {
      const id = skillOf.get(normalizeSkillName(term));
      return id ? [...new Set([nameOf.get(id)!, ...(aliasesOf.get(id) ?? [])])] : [];
    },
    skillsIn: text => new Set([...scanSkills(text, scanList).keys()].map(id => nameOf.get(id)!)),
    ambiguous: term => ambiguousAliases.has(normalizeSkillName(term)),
  };
  taxonomyCache = { at: Date.now(), value };
  return value;
}

// ───────────────────────── Job keywords (cached per posting) ─────────────────────────

/** The job's keywords, extracted once per posting text and validated against it. */
export async function getJobKeywords(userId: string, jobId: string) {
  const job = await loadFullJob(userId, jobId);
  if (job.extractionStatus === 'DONE') {
    const rows = await db.jobRequirement.findMany({ where: { jobId, keyword: { not: null } }, orderBy: { position: 'asc' } });
    const keywords: JobKeyword[] = rows.map(r => ({ keyword: r.keyword!, strict: r.kind !== 'OTHER', importance: r.importance, quote: r.quote }));
    return { job, keywords };
  }
  const tax = await taxonomy();
  const keywords = validateKeywords(job.descriptionText, await extractJobKeywords(userId, job.descriptionText), tax.synonyms);
  await db.$transaction([
    db.jobRequirement.deleteMany({ where: { jobId } }),
    db.jobRequirement.createMany({
      data: keywords.map((k, position) => ({
        jobId,
        kind: k.strict ? ('SKILL' as const) : ('OTHER' as const),
        importance: k.importance,
        quote: k.quote,
        keyword: k.keyword,
        position,
      })),
    }),
    db.job.update({ where: { id: jobId }, data: { extractionStatus: 'DONE' } }),
  ]);
  return { job, keywords };
}

// ───────────────────────── The CV, structured (cached per CV) ─────────────────────────

async function getCvForTailoring(userId: string) {
  const cv =
    (await db.cv.findFirst({ where: { userId, isDefault: true } })) ??
    (await db.cv.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }));
  if (!cv) return null;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
  // The model sees the CV without contact details or the name.
  const redacted = redactPii(cv.textContent, { names: [user.name] });

  let structure = cv.structure as CvStructure | null;
  if (!structure || cv.structureVersion !== STRUCTURE_PROMPT_VERSION) {
    structure = buildStructure(redacted.text, await structureCv(userId, redacted.text));
    await db.cv.update({ where: { id: cv.id }, data: { structure: structure as object, structureVersion: STRUCTURE_PROMPT_VERSION } });
  }
  return { cv, redactedText: redacted.text, structure };
}

// ───────────────────────── Tailoring ─────────────────────────

export interface TailorResult {
  status: 'OK';
  id: string;
  job: { id: string; title: string; company: string };
  cvLabel: string;
  keywordTotal: number;
  coverageBefore: number;
  coverageAfter: number;
  changes: TailorChange[];
  skillsAdded: string[];
  rejected: { before: string; proposed: string; reason: string }[];
  missing: string[];
  downloadUrl: string;
}

export type TailorOutcome =
  | TailorResult
  | { status: 'NEEDS_CV' }
  | { status: 'CV_UNREADABLE'; reason: string }
  | { status: 'JOB_NOT_FOUND' };

/**
 * Tailors the user's default CV to a job: the model proposes edits, the guard (server/tailor/guard.ts)
 * accepts only what the CV or the user's confirmations back. The result is saved for download.
 */
export async function tailorCvForJob(userId: string, jobId: string): Promise<TailorOutcome> {
  const cvData = await getCvForTailoring(userId);
  if (!cvData) return { status: 'NEEDS_CV' };
  const { cv, redactedText, structure } = cvData;
  if (bulletCount(structure) === 0) {
    return { status: 'CV_UNREADABLE', reason: "I couldn't find experience bullets in your CV. Try a PDF exported from Word or Google Docs." };
  }

  let job: Awaited<ReturnType<typeof getJobKeywords>>['job'];
  let keywords: JobKeyword[];
  try {
    ({ job, keywords } = await getJobKeywords(userId, jobId));
  } catch (error) {
    if (error instanceof NotFoundError) return { status: 'JOB_NOT_FOUND' };
    throw error;
  }

  const tax = await taxonomy();
  const confirmed = await db.confirmedExperience.findMany({ where: { userId }, select: { keyword: true, detail: true } });
  const inCv = (term: string) => [term, ...tax.synonyms(term)].some(t => containsTerm(redactedText, t));

  const output = await proposeTailoring(userId, {
    job: { title: job.title, company: job.company },
    keywords: keywords.map(k => ({
      keyword: k.keyword,
      kind: k.strict ? 'must be in the CV already' : 'may be reworded with evidence',
      importance: k.importance,
      inCv: inCv(k.keyword),
    })),
    confirmed,
    cv: {
      headline: structure.headline,
      summary: structure.summary,
      bullets: structure.sections.flatMap(section =>
        section.entries.flatMap(entry =>
          entry.bullets.map(b => ({ id: b.id, text: b.text, role: [entry.title, entry.organization].filter(Boolean).join(' @ ') })),
        ),
      ),
    },
  });

  const result = applyGuard({
    cvText: redactedText,
    structure,
    keywords,
    confirmed: confirmed.map(c => c.keyword),
    synonyms: tax.synonyms,
    skillsIn: tax.skillsIn,
    ambiguous: tax.ambiguous,
    output,
  });

  const saved = await db.tailoredCv.create({
    data: {
      userId,
      cvId: cv.id,
      jobId: job.id,
      content: result.structure as object,
      changes: result.changes as object[],
      rejected: result.rejected as object[],
      missing: result.missing,
      keywordTotal: result.keywordTotal,
      coverageBefore: result.coverageBefore,
      coverageAfter: result.coverageAfter,
      promptVersion: TAILOR_PROMPT_VERSION,
    },
    select: { id: true },
  });

  return {
    status: 'OK',
    id: saved.id,
    job: { id: job.id, title: job.title, company: job.company },
    cvLabel: cv.label,
    keywordTotal: result.keywordTotal,
    coverageBefore: result.coverageBefore,
    coverageAfter: result.coverageAfter,
    changes: result.changes.map(c => ({ ...c, bulletId: c.bulletId === SUMMARY_ID ? 'summary' : c.bulletId })),
    skillsAdded: result.skillsAdded,
    rejected: result.rejected.map(({ before, proposed, reason }) => ({ before, proposed, reason })),
    missing: result.missing,
    downloadUrl: `/api/tailored-cvs/${saved.id}/docx`,
  };
}

/** Everything needed to render a tailored CV, for its owner only. */
export async function getTailoredCvForDownload(userId: string, id: string) {
  const row = await db.tailoredCv.findFirst({
    where: { id, userId },
    select: { content: true, job: { select: { title: true, company: true } }, cv: { select: { textContent: true } }, user: { select: { name: true } } },
  });
  if (!row) throw new NotFoundError('Tailored CV');
  // Contact details come from the original CV text by pattern, never from a model.
  const { emails, phones, urls } = redactPii(row.cv.textContent);
  return {
    name: row.user.name,
    contact: [emails[0], phones[0], ...urls.slice(0, 2)].filter((c): c is string => Boolean(c)),
    structure: row.content as unknown as CvStructure,
    fileName: `${row.user.name} - CV for ${row.job.title} at ${row.job.company}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120),
  };
}

/** Records experience the user confirmed in chat (after clicking approve), so tailoring may use it. */
export async function confirmExperience(userId: string, keyword: string, detail: string) {
  const clean = keyword.trim().slice(0, 60);
  const row = await db.confirmedExperience.upsert({
    where: { userId_keywordKey: { userId, keywordKey: keywordKey(clean) } },
    create: { userId, keyword: clean, keywordKey: keywordKey(clean), detail: detail.trim().slice(0, 500) },
    update: { detail: detail.trim().slice(0, 500) },
    select: { keyword: true, detail: true },
  });
  return row;
}
