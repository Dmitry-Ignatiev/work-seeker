import { createHash } from 'node:crypto';
import { isIsraelLocation } from './location';
import { keywords, keywordScore } from './text';
import type { Job } from './types';

/** Pure ranking and dedupe for search results. */

export type Seniority = 'junior' | 'mid' | 'senior' | 'lead';

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|leader|leading|head|architect|manager|director|vp|experienced|expert)\b|בכיר|ראש צוות|מוביל/i;
const JUNIOR = /\b(junior|jr\.?|entry|graduate|intern|internship|student)\b|ג'וניור|בוגר|סטודנט/i;

/** Words that say how senior, not what the role is. */
const SENIORITY_WORDS = new Set(['junior', 'jr', 'senior', 'sr', 'lead', 'principal', 'staff', 'head', 'student', 'intern', 'internship', 'entry', 'graduate', 'mid', 'level', 'experienced']);
/** Words too generic to decide relevance on their own ("Market Analyst" is not a "developer" match). */
const GENERIC_WORDS = new Set([
  'engineer', 'engineers', 'engineering', 'developer', 'developers', 'dev', 'programmer', 'software', 'position', 'positions',
  'work', 'opening', 'openings', 'hiring', 'with', 'experience', 'years', 'year', 'looking', 'want', 'like', 'any', 'new',
  'tel', 'aviv', 'israel', 'herzliya', 'haifa', 'jerusalem', 'center', 'central', 'north', 'south', 'hybrid', 'onsite', 'office',
]);
/** Title spellings that mean the same role. Keys and values are compact (no spaces, dots or hyphens). */
const SYNONYMS: Record<string, string[]> = {
  qa: ['qa', 'test', 'testing', 'automation', 'sdet', 'quality'],
  automation: ['automation', 'qa', 'sdet', 'test'],
  devops: ['devops', 'sre', 'sitereliability', 'platform', 'infrastructure'],
  sre: ['sre', 'sitereliability', 'devops'],
  frontend: ['frontend', 'ui', 'react', 'angular', 'vue'],
  backend: ['backend', 'server', 'api'],
  fullstack: ['fullstack'],
  ml: ['ml', 'machinelearning', 'ai'],
  ai: ['ai', 'ml', 'machinelearning', 'llm', 'genai'],
  data: ['data', 'bi', 'analytics'],
  mobile: ['mobile', 'ios', 'android'],
  security: ['security', 'cyber', 'appsec'],
  cyber: ['cyber', 'security'],
  product: ['product'],
};

const compact = (s: string) => s.toLowerCase().replace(/[\s.\-_/]+/g, '');

const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Same role at the same company and place, whichever source listed it. */
export function jobFingerprint(job: Pick<Job, 'company' | 'title' | 'location'>): string {
  return createHash('sha256').update(`${norm(job.company)}|${norm(job.title)}|${norm(job.location)}`).digest('hex');
}

/**
 * The words that say what the role is ("full stack", "devops", "node.js"), as compact strings.
 * Adjacent words are also joined ("full" + "stack" → "fullstack") so any spelling matches.
 */
export function roleTerms(query: string): string[] {
  const words = keywords(query).filter(w => !SENIORITY_WORDS.has(w) && !GENERIC_WORDS.has(w) && !/^\d+$/.test(w));
  const terms = new Set(words.map(compact));
  for (let i = 0; i + 1 < words.length; i++) terms.add(compact(words[i] + words[i + 1]));
  return [...terms].filter(t => t.length > 1);
}

/** Does the title name the role? Generic words count only when the query has nothing more specific. */
export function titleMatchesRole(title: string, query: string): boolean {
  const titleCompact = compact(title);
  const titleWords = new Set(keywords(title).map(compact));
  const has = (term: string) => (term.length <= 3 ? titleWords.has(term) : titleCompact.includes(term));
  const terms = roleTerms(query);
  if (terms.length === 0) {
    const generic = keywords(query).filter(w => GENERIC_WORDS.has(w)).map(compact);
    return generic.length === 0 || generic.some(has);
  }
  if (terms.some(term => (OTHER_ROLES[term] ?? []).some(has) && !has(term))) return false;
  return terms.some(term => (SYNONYMS[term] ?? [term]).some(has));
}

/**
 * Roles that are not the one asked for: a "frontend" search must not return "Full Stack Engineer (React)"
 * just because React is a frontend word. A title naming both ("Frontend / Full Stack") still matches.
 */
const OTHER_ROLES: Record<string, string[]> = {
  frontend: ['fullstack', 'backend'],
  backend: ['fullstack', 'frontend'],
};

/**
 * Words to look for in job titles when pre-filtering stored jobs (SQL "contains"): role words, their
 * dot/hyphen-free spellings ("node.js" → "nodejs") and synonyms. The exact check is titleMatchesRole.
 */
export function titleSearchWords(query: string): string[] {
  const words = keywords(query).filter(w => !SENIORITY_WORDS.has(w) && !GENERIC_WORDS.has(w) && !/^\d+$/.test(w));
  const base = words.length > 0 ? words : keywords(query).filter(w => GENERIC_WORDS.has(w));
  const out = new Set<string>();
  for (const word of base) {
    out.add(word);
    out.add(compact(word));
    const first = word.split(/[.\-]/)[0];
    if (first.length > 1) out.add(first);
    for (const synonym of SYNONYMS[compact(word)] ?? []) out.add(synonym);
  }
  return [...out].filter(w => w.length > 1).slice(0, 20);
}

/** Seniority the user asked for, from the explicit option or the query words. */
export function wantedSeniority(query: string, explicit?: Seniority): Seniority | undefined {
  if (explicit) return explicit;
  const words = new Set(keywords(query));
  if (['junior', 'jr', 'student', 'intern', 'internship', 'entry', 'graduate'].some(w => words.has(w))) return 'junior';
  if (['senior', 'sr', 'staff', 'principal'].some(w => words.has(w))) return 'senior';
  if (words.has('lead') || words.has('head')) return 'lead';
  return undefined;
}

export interface RankOptions {
  query: string;
  seniority?: Seniority;
  /**
   * Sources whose results are already topical (a role category page). Their Hebrew-only titles skip the
   * title check (it only knows English role words); titles with English words are checked like any other.
   */
  topicalSources?: Set<Job['source']>;
  now?: Date;
}

/** Relevance score; 0 means "not relevant" and the job is dropped. */
export function scoreJob(job: Job, { query, seniority, topicalSources, now = new Date() }: RankOptions): number {
  const topical = topicalSources?.has(job.source) ?? false;
  const hebrewOnlyTitle = !/[a-z]{2,}/i.test(job.title);
  if (!(topical && hebrewOnlyTitle) && !titleMatchesRole(job.title, query)) return 0;

  const level = wantedSeniority(query, seniority);
  const isSenior = SENIOR.test(job.title);
  const isJunior = JUNIOR.test(job.title);
  if (level === 'junior' && isSenior && !isJunior) return 0;
  if ((level === 'senior' || level === 'lead') && isJunior) return 0;

  let score = keywordScore(job, keywords(query)) + (topical ? 1 : 0);
  if (score === 0) return 0;
  if (isIsraelLocation(job.location)) score += 2;
  if (level === 'junior' && isJunior) score += 3;
  if ((level === 'senior' || level === 'lead') && isSenior) score += 2;
  if (job.postedAt) {
    const days = (now.getTime() - new Date(job.postedAt).getTime()) / 86_400_000;
    if (days >= 0 && days <= 14) score += 1;
    else if (days > 90) score -= 1;
  }
  return Math.max(score, 1);
}

/** Drops duplicates (same fingerprint), keeping the first; sorts by score, best first. */
export function rankJobs(jobs: Job[], options: RankOptions): { job: Job; score: number }[] {
  const seen = new Set<string>();
  const ranked: { job: Job; score: number }[] = [];
  for (const job of jobs) {
    const fp = jobFingerprint(job);
    if (seen.has(fp)) continue;
    seen.add(fp);
    const score = scoreJob(job, options);
    if (score > 0) ranked.push({ job, score });
  }
  return ranked.sort((a, b) => b.score - a.score || (b.job.postedAt ?? '').localeCompare(a.job.postedAt ?? ''));
}
