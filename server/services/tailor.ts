import 'server-only';
import { redactPii } from '@/server/ai/redact';
import { extractJobKeywords, proposeTailoring, STRUCTURE_PROMPT_VERSION, structureCv, TAILOR_PROMPT_VERSION } from '@/server/ai/tailoring';
import { parseStoredLayout } from '@/server/cv/layout';
import { collectLinks, headerLinks, parseStoredLinks } from '@/server/cv/links';
import { buildCvDocx, restorePlaceholders, type ContactItem } from '@/server/tailor/docx';
import { lengthLimits } from '@/server/tailor/fit';
import { templateLayout } from '@/server/tailor/fallback-layout';
import { buildLayoutDocx } from '@/server/tailor/layout-docx';
import { buildLayoutPdf } from '@/server/tailor/layout-pdf';
import type { CvFileFormat } from '@/server/download';
import { db } from '@/server/db';
import { NotFoundError } from '@/server/errors';
import { scanSkills } from '@/server/matching/cv-skills';
import { normalizeSkillName } from '@/server/matching/skills';
import { applyGuard, SUMMARY_ID } from '@/server/tailor/guard';
import { containsDegree, containsTerm, keywordKey } from '@/server/tailor/text-match';
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

/**
 * For the job page: the job's concrete requirements (tools, technologies, degrees…) and, per CV of this user,
 * which of them that CV already shows (or the user confirmed). Reads keywords once per job (cached after).
 */
export async function jobRequirementsForCvs(userId: string, jobId: string) {
  const { keywords } = await getJobKeywords(userId, jobId);
  const strict = keywords.filter(k => k.strict);
  const [tax, cvs, confirmed] = await Promise.all([
    taxonomy(),
    db.cv.findMany({ where: { userId }, select: { id: true, textContent: true } }),
    db.confirmedExperience.findMany({ where: { userId }, select: { keyword: true } }),
  ]);
  const confirmedKeys = new Set(confirmed.flatMap(c => [keywordKey(c.keyword), ...tax.synonyms(c.keyword).map(keywordKey)]));
  const have: Record<string, string[]> = {};
  for (const cv of cvs) {
    have[cv.id] = strict
      .filter(
        k =>
          [k.keyword, ...tax.synonyms(k.keyword)].some(t => containsTerm(cv.textContent, t) || confirmedKeys.has(keywordKey(t))) ||
          containsDegree(cv.textContent, k.keyword),
      )
      .map(k => k.keyword);
  }
  return { requirements: strict.map(k => ({ keyword: k.keyword, importance: k.importance })), have };
}

// ───────────────────────── The CV, structured (cached per CV) ─────────────────────────

async function getCvForTailoring(userId: string, cvId?: string) {
  const cv =
    // The CV picked on the job page, if it's this user's; otherwise the default.
    (cvId ? await db.cv.findFirst({ where: { id: cvId, userId } }) : null) ??
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
  return { cv, userName: user.name, redactedText: redacted.text, structure };
}

/** How many characters each bullet and the summary may have so the CV keeps its page count (none without a layout). */
function limitsFor(cv: { layout: unknown }, structure: CvStructure, userName: string): Map<string, number> {
  const layout = parseStoredLayout(cv.layout);
  if (!layout) return new Map();
  const texts = [
    ...(structure.summary ? [{ id: SUMMARY_ID, text: structure.summary }] : []),
    ...structure.sections.flatMap(s => s.entries.flatMap(e => e.bullets.map(b => ({ id: b.id, text: b.text })))),
  ];
  return lengthLimits(layout, texts, text => redactPii(text, { names: [userName] }).text);
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
  /** Missing on results saved before PDF downloads existed. */
  pdfUrl?: string;
  /** How the DOCX looks: the user's own layout, or the template (and why). */
  layout: 'ORIGINAL' | 'MULTI_COLUMN' | 'TEMPLATE';
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
export async function tailorCvForJob(userId: string, jobId: string, cvId?: string): Promise<TailorOutcome> {
  const cvData = await getCvForTailoring(userId, cvId);
  if (!cvData) return { status: 'NEEDS_CV' };
  const { cv, userName, redactedText, structure } = cvData;
  if (bulletCount(structure) === 0) {
    return { status: 'CV_UNREADABLE', reason: "I couldn't find experience bullets in your CV. Try a PDF or Word file exported from Word or Google Docs." };
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
  const limits = limitsFor(cv, structure, userName);

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
      summaryMaxChars: limits.get(SUMMARY_ID),
      bullets: structure.sections.flatMap(section =>
        section.entries.flatMap(entry =>
          entry.bullets.map(b => ({
            id: b.id,
            text: b.text,
            role: [entry.title, entry.organization].filter(Boolean).join(' @ '),
            maxChars: limits.get(b.id),
          })),
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
    limits,
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
    // Only concrete things (tools, technologies, certifications): "customer obsession" isn't worth a prompt.
    missing: result.missing.filter(m => keywords.find(k => k.keyword === m)?.strict),
    downloadUrl: `/api/tailored-cvs/${saved.id}/docx`,
    pdfUrl: `/api/tailored-cvs/${saved.id}/pdf`,
    layout: parseStoredLayout(cv.layout) ? 'ORIGINAL' : cv.layoutNote === 'MULTI_COLUMN' ? 'MULTI_COLUMN' : 'TEMPLATE',
  };
}

/** Everything needed to render a tailored CV, for its owner only. */
export async function getTailoredCvForDownload(userId: string, id: string) {
  const row = await db.tailoredCv.findFirst({
    where: { id, userId },
    select: {
      content: true,
      changes: true,
      job: { select: { title: true, company: true } },
      cv: { select: { textContent: true, links: true, layout: true, structure: true } },
      user: { select: { name: true } },
    },
  });
  if (!row) throw new NotFoundError('Tailored CV');
  // Contact details come from the original CV (its text by pattern, its links from the PDF), never from a model.
  const { emails, phones, urls } = redactPii(row.cv.textContent);
  const pdfLinks = parseStoredLinks(row.cv.links);
  const links = collectLinks([...pdfLinks, ...urls.map(url => ({ url, anchor: '' }))]);
  const email = emails[0] ?? links.find(l => l.kind === 'EMAIL')?.label;
  const contact: ContactItem[] = [
    ...(email ? [{ text: email, url: `mailto:${email}` }] : []),
    ...(phones[0] ? [{ text: phones[0] }] : []),
    ...headerLinks(links).map(l => ({ text: l.label, url: l.url })),
  ];
  const structure = row.content as unknown as CvStructure;
  const originalSkills = (row.cv.structure as CvStructure | null)?.skills ?? [];
  return {
    name: row.user.name,
    contact,
    links,
    structure,
    /** The original page layout, when the PDF's could be read. */
    layout: parseStoredLayout(row.cv.layout),
    changes: (row.changes as unknown as TailorChange[]).map(c => ({ before: c.before, after: c.after })),
    skills: originalSkills,
    addedSkills: structure.skills.filter(s => !originalSkills.includes(s)),
    fileName: `${row.user.name} - CV for ${row.job.title} at ${row.job.company}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120),
  };
}

/**
 * The tailored CV as a DOCX or PDF: rebuilt from the user's own layout when the PDF's was readable, so it keeps
 * their design, wording and page count; otherwise the clean template. An edit that can't be placed in the layout
 * means the template is used, so no accepted change is ever lost. Both formats place the edits the same way.
 */
export async function renderTailoredCv(
  userId: string,
  id: string,
  format: CvFileFormat = 'docx',
): Promise<{ buffer: Buffer; fileName: string; usedLayout: boolean }> {
  const cv = await getTailoredCvForDownload(userId, id);
  const build = format === 'pdf' ? buildLayoutPdf : buildLayoutDocx;
  if (cv.layout) {
    const { buffer, unplaced } = await build({
      layout: cv.layout,
      edits: cv.changes,
      addedSkills: cv.addedSkills,
      skills: cv.skills,
      normalize: text => redactPii(text, { names: [cv.name] }).text,
      restore: text => restorePlaceholders(text, cv.name),
      title: cv.fileName,
    });
    if (unplaced === 0) return { buffer, fileName: cv.fileName, usedLayout: true };
  }
  if (format === 'pdf') {
    const { buffer } = await buildLayoutPdf({ layout: templateLayout(cv), edits: [], title: cv.fileName });
    return { buffer, fileName: cv.fileName, usedLayout: false };
  }
  return { buffer: await buildCvDocx(cv), fileName: cv.fileName, usedLayout: false };
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
