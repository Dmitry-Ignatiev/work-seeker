import { createHash } from 'node:crypto';
import { isIsraelLocation } from './location';
import { keywords, keywordScore } from './text';
import type { Job } from './types';

/** Pure ranking and dedupe for search results. */

export type Seniority = 'junior' | 'mid' | 'senior' | 'lead';

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|head|architect|manager|director|vp)\b|בכיר|ראש צוות/i;
const JUNIOR = /\b(junior|jr\.?|entry|graduate|intern|student)\b|ג'וניור|בוגר|סטודנט/i;

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

export interface RankOptions {
  query: string;
  seniority?: Seniority;
  /** Sources whose results are already topical (e.g. a role category page) get a small base score. */
  topicalSources?: Set<Job['source']>;
  now?: Date;
}

/** Relevance score; 0 means "not relevant" and the job is dropped. */
export function scoreJob(job: Job, { query, seniority, topicalSources, now = new Date() }: RankOptions): number {
  const words = keywords(query);
  let score = keywordScore(job, words);
  if (topicalSources?.has(job.source)) score += 1;
  if (score === 0) return 0;

  if (isIsraelLocation(job.location)) score += 2;
  if (seniority === 'senior' || seniority === 'lead') score += SENIOR.test(job.title) ? 2 : 0;
  if (seniority === 'junior') score += JUNIOR.test(job.title) ? 3 : SENIOR.test(job.title) ? -3 : 0;
  if (job.postedAt) {
    const days = (now.getTime() - new Date(job.postedAt).getTime()) / 86_400_000;
    if (days >= 0 && days <= 14) score += 1;
    else if (days > 90) score -= 1;
  }
  return Math.max(score, 0);
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
