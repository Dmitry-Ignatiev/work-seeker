/**
 * Judges whether a search result is relevant to what was asked: right role, right place, right level, recent.
 * Used by the search quality report (scripts/relevance-check.mts). Pure, and deliberately independent of
 * ranking.ts: the expectations are written per test case, so the report can catch ranking mistakes.
 */
import { isIsraelLocation, isRemoteLocation } from './location';

export type Region = 'tel-aviv' | 'center' | 'jerusalem' | 'haifa-north' | 'south' | 'israel' | 'remote';

const TEL_AVIV = String.raw`tel[\s-]?aviv|\btlv\b|תל[\s-]?אביב|ת"א`;
const REGIONS: Record<Exclude<Region, 'israel' | 'remote'>, RegExp> = {
  'tel-aviv': new RegExp(TEL_AVIV, 'i'),
  center: new RegExp(
    TEL_AVIV +
      String.raw`|ramat[\s-]?gan|givatayim|petah?c?h?[\s-]?tik?va|herzliy?a|ra'?anana|kfar[\s-]?saba|hod[\s-]?hasharon|rishon|holon|bnei[\s-]?brak|or[\s-]?yehuda|airport[\s-]?city|rehovot|ness[\s-]?ziona|modi'?in|netanya|lod|ramla|yehud|המרכז|מרכז|רמת[\s-]?גן|פתח[\s-]?תקווה|הרצליה|רעננה|כפר[\s-]?סבא|השרון`,
    'i',
  ),
  jerusalem: /jerusalem|ירושלים/i,
  'haifa-north': /haifa|yo[kq]neam|nazareth|caesarea|matam|karmiel|tiberias|חיפה|יקנעם|הצפון|צפון/i,
  south: /be'?er[\s-]?sheva|beersheba|ashdod|ashkelon|eilat|באר[\s-]?שבע|אשדוד|הדרום|דרום/i,
};
/** Remote roles a person in Israel can take: worldwide, EMEA/Europe-wide, or explicitly Israel. */
const OPEN_REMOTE = /worldwide|anywhere|global|emea|europe|israel|\bil\b|ישראל/i;

const SENIOR_TITLE = /\b(senior|sr\.?|lead|principal|staff|head|director|manager|architect|vp)\b|בכיר|ראש צוות/i;
const JUNIOR_TITLE = /\b(junior|jr\.?|intern|internship|student|graduate|entry)\b|ג'?וניור|סטודנט/i;

export const STALE_DAYS = 60;

export interface RelevanceCase {
  name: string;
  /** What the assistant would send to searchJobs. */
  search: { query: string; location?: string; remoteOnly?: boolean; seniority?: 'junior' | 'mid' | 'senior' | 'lead' };
  /** A relevant title matches at least one of these. */
  roleTitle: RegExp[];
  region: Region;
  level?: 'junior' | 'senior';
}

export interface JudgedJob {
  title: string;
  company: string;
  location: string;
  remote: boolean;
  postedAt: string | null;
  source: string;
  checks: { role: boolean; place: boolean; level: boolean | null; fresh: boolean | null };
  relevant: boolean;
  /** Why it isn't relevant, in plain words; empty when it is. */
  problems: string[];
}

export interface JobLike {
  title: string;
  company: string;
  location: string;
  remote: boolean;
  postedAt: string | null;
  source: string;
}

export function placeMatches(region: Region, job: Pick<JobLike, 'location' | 'remote'>): boolean {
  const remote = job.remote || isRemoteLocation(job.location);
  if (region === 'remote') return remote && (OPEN_REMOTE.test(job.location) || !/\b(us|usa|united states|uk|canada|australia|india|latam)\b/i.test(job.location));
  if (remote) return isIsraelLocation(job.location) || OPEN_REMOTE.test(job.location);
  if (region === 'israel') return isIsraelLocation(job.location);
  return REGIONS[region].test(job.location);
}

export function judgeJob(c: RelevanceCase, job: JobLike, now = new Date()): JudgedJob {
  const role = c.roleTitle.some(pattern => pattern.test(job.title));
  const place = placeMatches(c.region, job);
  const level = c.level === 'junior' ? !SENIOR_TITLE.test(job.title) : c.level === 'senior' ? !JUNIOR_TITLE.test(job.title) : null;
  const age = job.postedAt ? (now.getTime() - new Date(job.postedAt).getTime()) / 86_400_000 : null;
  const fresh = age === null || Number.isNaN(age) ? null : age <= STALE_DAYS;

  const problems: string[] = [];
  if (!role) problems.push('different role');
  if (!place) problems.push(`not in ${c.region}`);
  if (level === false) problems.push(`not ${c.level}`);
  if (fresh === false) problems.push(`posted ${Math.round(age!)} days ago`);
  return { ...job, checks: { role, place, level, fresh }, relevant: problems.length === 0, problems };
}

export interface CaseResult {
  case: RelevanceCase;
  jobs: JudgedJob[];
  /** Share of returned jobs that pass every check (0–1); null when nothing came back. */
  precision: number | null;
  failedSources: string[];
  ms: number;
}

export function summarize(results: CaseResult[]): { cases: number; jobs: number; relevant: number; precision: number | null; empty: number } {
  const jobs = results.flatMap(r => r.jobs);
  const relevant = jobs.filter(j => j.relevant).length;
  return {
    cases: results.length,
    jobs: jobs.length,
    relevant,
    precision: jobs.length ? relevant / jobs.length : null,
    empty: results.filter(r => r.jobs.length === 0).length,
  };
}
