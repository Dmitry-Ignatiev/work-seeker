import { getJson } from '../http';
import { isRemoteLocation } from '../location';
import { htmlToText } from '../text';
import type { Job } from '../types';

/**
 * Official public job-board APIs of Greenhouse, Lever and Ashby: built for embedding,
 * no key, no scraping. Each board is one company's careers page.
 */
export type Ats = 'greenhouse' | 'lever' | 'ashby';

export interface BoardRef {
  ats: Ats;
  slug: string;
  companyName: string;
}

export const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  first_published?: string;
  updated_at?: string;
  departments?: { name: string }[];
}

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: { location?: string; allLocations?: string[]; team?: string; commitment?: string };
  workplaceType?: string;
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
  createdAt?: number;
}

interface AshbyJob {
  id: string;
  title: string;
  jobUrl: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isRemote?: boolean | null;
  workplaceType?: string | null;
  department?: string;
  team?: string;
  employmentType?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  address?: { postalAddress?: { addressLocality?: string; addressCountry?: string } };
}

export function normalizeGreenhouse(board: BoardRef, j: GreenhouseJob): Job {
  const location = j.location?.name?.trim() || 'Unknown';
  return {
    id: `greenhouse:${board.slug}:${j.id}`,
    source: 'greenhouse',
    title: j.title.trim(),
    company: board.companyName,
    location,
    remote: isRemoteLocation(location),
    tags: (j.departments ?? []).map(d => d.name).filter(Boolean),
    url: j.absolute_url,
    postedAt: j.first_published ?? j.updated_at,
    description: htmlToText(j.content),
  };
}

export function normalizeLever(board: BoardRef, j: LeverJob): Job {
  const locations = [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean) as string[];
  const location = [...new Set(locations)].join(' · ') || 'Unknown';
  const sections = (j.lists ?? []).map(list => `${list.text}\n${htmlToText(list.content)}`);
  return {
    id: `lever:${board.slug}:${j.id}`,
    source: 'lever',
    title: j.text.trim(),
    company: board.companyName,
    location,
    remote: j.workplaceType === 'remote' || isRemoteLocation(location),
    tags: [j.categories?.team, j.categories?.commitment].filter((t): t is string => Boolean(t)),
    url: j.hostedUrl,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
    description: [j.descriptionPlain, ...sections, j.additionalPlain].filter(Boolean).join('\n\n').trim(),
  };
}

export function normalizeAshby(board: BoardRef, j: AshbyJob): Job {
  const address = j.address?.postalAddress;
  const parts = [j.location, address?.addressLocality, address?.addressCountry, ...(j.secondaryLocations ?? []).map(l => l.location)];
  const location = [...new Set(parts.filter(Boolean) as string[])].join(' · ') || 'Unknown';
  return {
    id: `ashby:${board.slug}:${j.id}`,
    source: 'ashby',
    title: j.title.trim(),
    company: board.companyName,
    location,
    remote: Boolean(j.isRemote) || j.workplaceType === 'Remote' || isRemoteLocation(location),
    tags: [j.department, j.team, j.employmentType].filter((t, i, all): t is string => Boolean(t) && all.indexOf(t) === i),
    url: j.jobUrl,
    postedAt: j.publishedAt,
    description: (j.descriptionPlain ?? '').trim(),
  };
}

/** Every open job on one company board. */
export async function fetchBoard(board: BoardRef): Promise<Job[]> {
  if (!SLUG_PATTERN.test(board.slug)) throw new Error(`Invalid board slug "${board.slug}"`);
  const slug = encodeURIComponent(board.slug);
  switch (board.ats) {
    case 'greenhouse': {
      const data = await getJson<{ jobs: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
      return data.jobs.map(j => normalizeGreenhouse(board, j));
    }
    case 'lever': {
      const data = await getJson<LeverJob[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`);
      return data.map(j => normalizeLever(board, j));
    }
    case 'ashby': {
      const data = await getJson<{ jobs: AshbyJob[] }>(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
      return data.jobs.map(j => normalizeAshby(board, j));
    }
  }
}

/** One posting from a board, when a user pastes its link. */
export async function fetchBoardJob(board: BoardRef, jobId: string): Promise<Job | null> {
  if (!SLUG_PATTERN.test(board.slug) || !/^[A-Za-z0-9-]{1,64}$/.test(jobId)) return null;
  const slug = encodeURIComponent(board.slug);
  try {
    if (board.ats === 'greenhouse') {
      const j = await getJson<GreenhouseJob>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs/${jobId}`);
      return normalizeGreenhouse(board, j);
    }
    if (board.ats === 'lever') {
      const j = await getJson<LeverJob>(`https://api.lever.co/v0/postings/${slug}/${jobId}?mode=json`);
      return normalizeLever(board, j);
    }
    return (await fetchBoard(board)).find(job => job.id === `ashby:${board.slug}:${jobId}`) ?? null;
  } catch {
    return null;
  }
}
