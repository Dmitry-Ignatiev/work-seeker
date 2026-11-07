import 'server-only';
import { createHash } from 'node:crypto';
import type { JobSource as DbJobSource, Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { detectJobSource } from '@/server/discovery/ats/detect';
import { fetchBoard, fetchBoardJob, type Ats, type BoardRef, SLUG_PATTERN } from '@/server/discovery/ats/boards';
import { extractJobPostings, jobLocationText, str } from '@/server/discovery/jsonld';
import { isIsraelLocation, isRemoteLocation } from '@/server/discovery/location';
import { FetchBlockedError } from '@/server/discovery/net/safe-fetch';
import { politeFetch } from '@/server/discovery/net/polite-fetch';
import { needsPaste, normalizeUrl } from '@/server/discovery/normalize-url';
import { jobFingerprint, rankJobs, titleSearchWords, type Seniority } from '@/server/discovery/ranking';
import { enabledSources } from '@/server/discovery/registry';
import { fetchGotFriendsJob, GOTFRIENDS_COMPANY } from '@/server/discovery/scrape/gotfriends';
import { fixtureJobs } from '@/server/discovery/sources/fixture';
import { htmlToText } from '@/server/discovery/text';
import type { Job, SourceAdapter } from '@/server/discovery/types';
import { NotFoundError } from '@/server/errors';

export const SOURCE_TIMEOUT_MS = 8_000;
const BOARD_TTL_MS = 6 * 60 * 60 * 1000;
const BOARD_CONCURRENCY = 8;
/** Network time a search may spend refreshing stale boards (DB sync comes after, within SOURCE_TIMEOUT_MS). */
const BOARD_FETCH_BUDGET_MS = 4_000;
/** Stalest boards first; the rest are refreshed by the next searches. Keeps a cold start bounded. */
const MAX_BOARDS_PER_REFRESH = 20;
const MIN_PAGE_TEXT = 500;
const MAX_DESCRIPTION = 30_000;

const DB_SOURCE: Record<Job['source'], DbJobSource> = {
  remotive: 'REMOTIVE',
  arbeitnow: 'ARBEITNOW',
  remoteok: 'REMOTEOK',
  adzuna: 'ADZUNA',
  jsearch: 'JSEARCH',
  gotfriends: 'GOTFRIENDS',
  greenhouse: 'GREENHOUSE',
  lever: 'LEVER',
  ashby: 'ASHBY',
};

const SOURCE_LABEL: Record<DbJobSource, string> = {
  REMOTIVE: 'Remotive',
  ARBEITNOW: 'Arbeitnow',
  REMOTEOK: 'Remote OK',
  ADZUNA: 'Adzuna',
  JSEARCH: 'Google for Jobs',
  GOTFRIENDS: 'GotFriends',
  GREENHOUSE: 'Company careers page',
  LEVER: 'Company careers page',
  ASHBY: 'Company careers page',
  URL: 'Link you shared',
  PASTE: 'Description you pasted',
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ───────────────────────── Public shapes ─────────────────────────

export interface JobSummary {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  source: string;
  url: string | null;
  postedAt: string | null;
  /** First ~280 characters of the description. */
  snippet: string;
}

export interface SourceStatus {
  source: string;
  ok: boolean;
  found: number;
  error?: string;
}

export interface SearchJobsInput {
  query: string;
  location?: string;
  remoteOnly?: boolean;
  seniority?: Seniority;
  limit?: number;
}

type JobRow = Prisma.JobGetPayload<{ select: typeof summarySelect }>;

const summarySelect = {
  id: true,
  title: true,
  company: true,
  location: true,
  remoteType: true,
  source: true,
  sourceJobId: true,
  canonicalUrl: true,
  postedAt: true,
  descriptionText: true,
} as const;

function toSummary(row: JobRow): JobSummary {
  const text = row.descriptionText.replace(/\s+/g, ' ').trim();
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    location: row.location ?? 'Unknown',
    remote: row.remoteType === 'REMOTE',
    // Offline demo listings (server/discovery/sources/fixture.ts) must never look like a real source.
    source: row.sourceJobId?.startsWith('fixture-') ? 'Demo listing' : SOURCE_LABEL[row.source],
    url: row.canonicalUrl,
    postedAt: row.postedAt?.toISOString() ?? null,
    snippet: text.length > 280 ? `${text.slice(0, 277)}…` : text,
  };
}

// ───────────────────────── Persistence ─────────────────────────

function sourceJobId(job: Job): string {
  return job.id.slice(job.id.indexOf(':') + 1);
}

function jobData(job: Job) {
  const postedAt = job.postedAt ? new Date(job.postedAt) : null;
  const description = job.description.slice(0, MAX_DESCRIPTION);
  return {
    title: job.title.slice(0, 300),
    company: job.company.slice(0, 200) || 'Unknown company',
    location: job.location.slice(0, 200),
    countryCode: isIsraelLocation(job.location) ? 'IL' : null,
    remoteType: job.remote ? ('REMOTE' as const) : ('UNKNOWN' as const),
    canonicalUrl: normalizeUrl(job.url)?.toString() ?? null,
    fingerprint: jobFingerprint(job),
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
    descriptionText: description,
    contentHash: sha256(description),
  };
}

/** Upserts public discovered jobs; returns their DB ids in input order. */
async function upsertJobs(jobs: Job[]): Promise<string[]> {
  const ids: string[] = [];
  for (const job of jobs) {
    const data = jobData(job);
    const source = DB_SOURCE[job.source];
    const row = await db.job.upsert({
      where: { source_sourceJobId: { source, sourceJobId: sourceJobId(job) } },
      create: { ...data, source, sourceJobId: sourceJobId(job) },
      update: { ...data, lastSeenAt: new Date(), closedAt: null },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

// ───────────────────────── Company boards (DB-backed) ─────────────────────────

const toAts = (ats: string) => ats.toLowerCase() as Ats;

type BoardSource = { id: string; ats: string; slug: string; companyName: string };

const boardRef = (source: BoardSource): BoardRef => ({ ats: toAts(source.ats), slug: source.slug, companyName: source.companyName });

async function recordBoardError(source: BoardSource, error: unknown) {
  await db.careerSource.update({
    where: { id: source.id },
    data: { lastFetchedAt: new Date(), lastError: error instanceof Error ? error.message.slice(0, 300) : 'failed' },
  });
}

/** Fetches one board and syncs its Israeli/remote jobs: new ones inserted, missing ones closed. */
export async function refreshBoard(source: BoardSource): Promise<number> {
  let all: Job[];
  try {
    all = await fetchBoard(boardRef(source));
  } catch (error) {
    await recordBoardError(source, error);
    throw error;
  }
  return syncBoard(source, all);
}

/** Writes one board's fetched jobs. Called sequentially: the database sees one board at a time. */
async function syncBoard(source: BoardSource, all: Job[]): Promise<number> {
  const board = boardRef(source);
  try {
    const relevant = all.filter(job => job.remote || isIsraelLocation(job.location));
    const dbSource = DB_SOURCE[board.ats];
    const now = new Date();
    const seenIds = relevant.map(sourceJobId);

    const existing = await db.job.findMany({
      where: { source: dbSource, sourceJobId: { in: seenIds } },
      select: { sourceJobId: true },
    });
    const known = new Set(existing.map(e => e.sourceJobId).filter((id): id is string => id !== null));
    const fresh = relevant.filter(job => !known.has(sourceJobId(job)));
    await db.$transaction([
      db.job.createMany({
        data: fresh.map(job => ({ ...jobData(job), source: dbSource, sourceJobId: sourceJobId(job), careerSourceId: source.id })),
        skipDuplicates: true,
      }),
      db.job.updateMany({
        where: { source: dbSource, sourceJobId: { in: [...known] } },
        data: { lastSeenAt: now, closedAt: null, careerSourceId: source.id },
      }),
      db.job.updateMany({
        where: { careerSourceId: source.id, closedAt: null, sourceJobId: { notIn: seenIds } },
        data: { closedAt: now },
      }),
      db.careerSource.update({ where: { id: source.id }, data: { lastFetchedAt: now, lastError: null } }),
    ]);
    return relevant.length;
  } catch (error) {
    await recordBoardError(source, error);
    throw error;
  }
}

/**
 * Refreshes boards not fetched in the last 6 hours. Network fetches run in parallel (a few at a time)
 * within `fetchBudgetMs`; boards that miss the budget stay stale and are tried by the next search.
 * Database writes then run one board after another, before returning: no work is left in the background.
 * Failures are recorded on the board, not thrown.
 */
export async function refreshStaleBoards(fetchBudgetMs = BOARD_FETCH_BUDGET_MS): Promise<void> {
  const stale = await db.careerSource.findMany({
    where: { enabled: true, OR: [{ lastFetchedAt: null }, { lastFetchedAt: { lt: new Date(Date.now() - BOARD_TTL_MS) } }] },
    orderBy: { lastFetchedAt: { sort: 'asc', nulls: 'first' } },
    take: MAX_BOARDS_PER_REFRESH,
    select: { id: true, ats: true, slug: true, companyName: true },
  });
  const deadline = Date.now() + fetchBudgetMs;
  const fetched: { source: BoardSource; jobs?: Job[]; error?: unknown }[] = [];
  const queue = [...stale];
  await Promise.all(
    Array.from({ length: Math.min(BOARD_CONCURRENCY, queue.length) }, async () => {
      for (let source = queue.shift(); source && Date.now() < deadline; source = queue.shift()) {
        try {
          const jobs = await withTimeout(fetchBoard(boardRef(source)), Math.max(deadline - Date.now(), 1));
          fetched.push({ source, jobs });
        } catch (error) {
          // Out of time: leave it stale for the next search rather than marking it broken.
          if (!(error instanceof Error && error.message === 'timed out')) fetched.push({ source, error });
        }
      }
    }),
  );
  for (const { source, jobs, error } of fetched) {
    if (jobs) await syncBoard(source, jobs).catch(() => undefined);
    else await recordBoardError(source, error);
  }
}

/** Searches stored company-board jobs whose title names the role; ranking then checks relevance exactly. */
async function searchBoards(query: string): Promise<Job[]> {
  await refreshStaleBoards();
  const words = titleSearchWords(query);
  if (words.length === 0) return [];
  const rows = await db.job.findMany({
    where: {
      careerSourceId: { not: null },
      closedAt: null,
      OR: words.map(w => ({ title: { contains: w, mode: 'insensitive' as const } })),
    },
    orderBy: { postedAt: 'desc' },
    take: 300,
    select: summarySelect,
  });
  return rows.map(row => ({
    id: `${row.source.toLowerCase()}:${row.sourceJobId}`,
    source: row.source.toLowerCase() as Job['source'],
    title: row.title,
    company: row.company,
    location: row.location ?? '',
    remote: row.remoteType === 'REMOTE',
    tags: [],
    url: row.canonicalUrl ?? '',
    postedAt: row.postedAt?.toISOString(),
    description: row.descriptionText,
  }));
}

export const companyBoards: SourceAdapter = {
  name: 'greenhouse',
  label: 'Company careers pages',
  enabled: () => true,
  search: ({ query }) => searchBoards(query),
  // Room for a 4 s board refresh plus the database sync after a cold start.
  timeoutMs: 15_000,
};

// ───────────────────────── Search ─────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      value => (clearTimeout(timer), resolve(value)),
      error => (clearTimeout(timer), reject(error)),
    );
  });
}

function friendlyError(error: unknown): string {
  if (error instanceof FetchBlockedError) return error.message;
  if (error instanceof Error && error.message === 'timed out') return "didn't answer in time";
  return 'unavailable right now';
}

export interface SearchDeps {
  sources: SourceAdapter[];
}

/** E2E runs (E2E=1) search offline fixtures only: browser tests never contact real job sites. */
const defaultDeps = (): SearchDeps =>
  process.env.E2E === '1' ? { sources: [fixtureJobs] } : { sources: [companyBoards, ...enabledSources()] };

/**
 * Searches every enabled source in parallel. A slow or failing source never breaks the search:
 * it is reported in `sources` and the rest still answer. The top results are saved as Jobs.
 */
export async function searchJobs(
  input: SearchJobsInput,
  deps: SearchDeps = defaultDeps(),
): Promise<{ jobs: JobSummary[]; sources: SourceStatus[] }> {
  const query = input.query.trim().slice(0, 200);
  const params = { query, location: input.location, remoteOnly: input.remoteOnly };

  const settled = await Promise.allSettled(
    deps.sources.map(source => withTimeout(source.search(params), source.timeoutMs ?? SOURCE_TIMEOUT_MS)),
  );
  const found: Job[] = [];
  /** job id → index of the source that returned it, for per-source counts. */
  const origin = new Map<string, number>();
  const sources: SourceStatus[] = deps.sources.map((source, i) => {
    const result = settled[i];
    if (result.status === 'rejected') return { source: source.label, ok: false, found: 0, error: friendlyError(result.reason) };
    for (const job of result.value) {
      found.push(job);
      if (!origin.has(job.id)) origin.set(job.id, i);
    }
    return { source: source.label, ok: true, found: 0 };
  });

  const wantedPlace = input.location?.trim();
  const filtered = found.filter(job => {
    if (input.remoteOnly) return job.remote;
    if (job.remote) return true;
    if (wantedPlace && !/israel|ישראל/i.test(wantedPlace)) {
      return job.location.toLowerCase().includes(wantedPlace.toLowerCase()) || isIsraelLocation(job.location);
    }
    return isIsraelLocation(job.location);
  });

  const ranked = rankJobs(filtered, {
    query: [query, wantedPlace].filter(Boolean).join(' '),
    seniority: input.seniority,
    topicalSources: new Set(['gotfriends']),
  }).slice(0, Math.min(input.limit ?? 12, 25));

  for (const { job } of ranked) {
    const index = origin.get(job.id);
    if (index !== undefined) sources[index].found++;
  }

  const ids = await upsertJobs(ranked.map(r => r.job));
  const rows = await db.job.findMany({ where: { id: { in: ids } }, select: summarySelect });
  const byId = new Map(rows.map(row => [row.id, row]));
  return { jobs: ids.map(id => toSummary(byId.get(id)!)), sources };
}

// ───────────────────────── Reading one job ─────────────────────────

export type AddJobResult =
  | { status: 'OK'; job: JobSummary }
  | { status: 'NEEDS_PASTE'; reason: string }
  | { status: 'INVALID'; reason: string };

/** A job the user may see: public, or private and theirs. */
export async function getJobForUser(userId: string, jobId: string) {
  const job = await db.job.findFirst({
    where: { id: jobId, OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
  });
  if (!job) throw new NotFoundError('Job');
  return job;
}

export async function getJobSummary(userId: string, jobId: string): Promise<JobSummary> {
  return toSummary(await getJobForUser(userId, jobId));
}

/**
 * GotFriends listings carry a short summary; the job page has the requirements.
 * Fetches it once (politely) and stores the full text.
 */
export async function loadFullJob(userId: string, jobId: string) {
  const job = await getJobForUser(userId, jobId);
  if (job.source !== 'GOTFRIENDS' || !job.canonicalUrl || /דרישות|requirements/i.test(job.descriptionText)) return job;
  try {
    const page = await fetchGotFriendsJob(job.canonicalUrl);
    if (!page.description || page.description.length <= job.descriptionText.length) return job;
    const descriptionText = page.description.slice(0, MAX_DESCRIPTION);
    return await db.job.update({
      where: { id: job.id },
      data: { descriptionText, contentHash: sha256(descriptionText), location: page.location ?? job.location },
    });
  } catch {
    return job; // The summary is still usable.
  }
}

/** Adds a job from a link. Blocked sites, client-rendered pages and thin pages ask for a paste instead. */
export async function addJobFromUrl(userId: string, rawUrl: string): Promise<AddJobResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { status: 'INVALID', reason: "That doesn't look like a web link." };
  if (needsPaste(url)) {
    return { status: 'NEEDS_PASTE', reason: `${url.hostname} doesn't allow automated reading. Paste the job description instead.` };
  }

  const known = await db.job.findFirst({
    where: { canonicalUrl: url.toString(), OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
    select: summarySelect,
  });
  if (known) return { status: 'OK', job: toSummary(known) };

  const detected = detectJobSource(url);
  try {
    if (detected?.kind === 'board' && detected.jobId && SLUG_PATTERN.test(detected.slug)) {
      const source = await db.careerSource.findUnique({
        where: { ats_slug: { ats: detected.ats.toUpperCase() as 'GREENHOUSE', slug: detected.slug } },
      });
      const job = await fetchBoardJob(
        { ats: detected.ats, slug: detected.slug, companyName: source?.companyName ?? titleCase(detected.slug) },
        detected.jobId,
      );
      if (job) {
        const [id] = await upsertJobs([job]);
        return { status: 'OK', job: await getJobSummary(userId, id) };
      }
    }
    if (detected?.kind === 'gotfriends' && detected.jobId) {
      const page = await fetchGotFriendsJob(url.toString());
      if (page.title && page.description) {
        const [id] = await upsertJobs([
          {
            id: `gotfriends:${detected.jobId}`,
            source: 'gotfriends',
            title: page.title,
            company: GOTFRIENDS_COMPANY,
            location: page.location ?? 'Israel',
            remote: isRemoteLocation(page.location),
            tags: [],
            url: url.toString(),
            description: page.description,
          },
        ]);
        return { status: 'OK', job: await getJobSummary(userId, id) };
      }
    }
    return await addGenericPage(userId, url);
  } catch (error) {
    const reason = error instanceof FetchBlockedError ? error.message : "Couldn't read that page.";
    return { status: 'NEEDS_PASTE', reason: `${reason} Paste the job description instead.` };
  }
}

async function addGenericPage(userId: string, url: URL): Promise<AddJobResult> {
  const page = await politeFetch(url.toString());
  const posting = extractJobPostings(page.text)[0];
  const title = posting ? str(posting.title) : htmlToText(page.text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]) || undefined;
  const description = posting
    ? htmlToText(str(posting.description))
    : htmlToText(page.text.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, ' '));
  if (!title || description.length < MIN_PAGE_TEXT) {
    return { status: 'NEEDS_PASTE', reason: "That page doesn't show the job text to automated readers. Paste the description instead." };
  }
  return addJobFromText(userId, {
    text: description,
    title,
    company: posting ? (str(posting.hiringOrganization) ?? url.hostname) : url.hostname,
    location: posting ? jobLocationText(posting.jobLocation) : undefined,
    url: url.toString(),
    source: 'URL',
  });
}

/** Stores a pasted (or privately fetched) description. Private to this user. */
export async function addJobFromText(
  userId: string,
  input: { text: string; title?: string; company?: string; location?: string; url?: string; source?: 'PASTE' | 'URL' },
): Promise<AddJobResult> {
  const text = input.text.trim().slice(0, MAX_DESCRIPTION);
  if (text.length < 200) return { status: 'INVALID', reason: 'That description is too short. Paste the full job post.' };
  const contentHash = sha256(text);
  const title = (input.title?.trim() || text.split('\n')[0]).slice(0, 200);
  const company = input.company?.trim() || 'Unknown company';
  const location = input.location?.trim() || '';
  const source = input.source ?? 'PASTE';
  const sourceJobId = sha256(`${userId}:${contentHash}`);

  const row = await db.job.upsert({
    where: { source_sourceJobId: { source, sourceJobId } },
    create: {
      source,
      sourceJobId,
      ownerUserId: userId,
      title,
      company,
      location,
      countryCode: isIsraelLocation(location) ? 'IL' : null,
      remoteType: isRemoteLocation(`${location} ${text.slice(0, 2000)}`) ? 'REMOTE' : 'UNKNOWN',
      canonicalUrl: input.url ?? null,
      fingerprint: jobFingerprint({ company, title, location }),
      descriptionText: text,
      contentHash,
    },
    update: { lastSeenAt: new Date() },
    select: summarySelect,
  });
  return { status: 'OK', job: toSummary(row) };
}

// ───────────────────────── Following companies ─────────────────────────

const titleCase = (slug: string) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export type FollowResult =
  | { status: 'OK'; companyName: string; openRoles: number; alreadyFollowed: boolean }
  | { status: 'UNSUPPORTED'; reason: string };

/** Adds a company's Greenhouse/Lever/Ashby board to the searched boards (shared, public data). */
export async function followCompany(userId: string, careersUrl: string, companyName?: string): Promise<FollowResult> {
  const url = normalizeUrl(careersUrl);
  const detected = url ? detectJobSource(url) : null;
  if (detected?.kind !== 'board' || !SLUG_PATTERN.test(detected.slug)) {
    return {
      status: 'UNSUPPORTED',
      reason: 'I can follow careers pages hosted on Greenhouse, Lever or Ashby (links like boards.greenhouse.io/<company>).',
    };
  }
  const ats = detected.ats.toUpperCase() as 'GREENHOUSE' | 'LEVER' | 'ASHBY';
  const existing = await db.careerSource.findUnique({ where: { ats_slug: { ats, slug: detected.slug } } });
  const name = existing?.companyName ?? companyName?.trim().slice(0, 100) ?? titleCase(detected.slug);

  let jobs: Job[];
  try {
    jobs = await fetchBoard({ ats: detected.ats, slug: detected.slug, companyName: name });
  } catch {
    return { status: 'UNSUPPORTED', reason: "That careers page didn't answer. Check the link." };
  }
  const source = await db.careerSource.upsert({
    where: { ats_slug: { ats, slug: detected.slug } },
    create: { ats, slug: detected.slug, companyName: name, addedByUserId: userId },
    update: { enabled: true },
  });
  const openRoles = await refreshBoard(source).catch(() => 0);
  return { status: 'OK', companyName: name, openRoles: openRoles || jobs.length, alreadyFollowed: Boolean(existing) };
}
