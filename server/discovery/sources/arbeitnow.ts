import { cached, getJson } from '../http';
import { htmlToText } from '../text';
import type { Job, SourceAdapter } from '../types';

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
}

const TTL = 60 * 60 * 1000; // feed updates hourly
const PAGES = 3; // 300 jobs per page

/** Arbeitnow has no search parameter: fetch the latest feed pages and filter locally. */
async function loadFeed(): Promise<Job[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) =>
      getJson<{ data: ArbeitnowJob[] }>(
        `https://www.arbeitnow.com/api/job-board-api?page=${i + 1}`,
      ).catch(() => ({ data: [] as ArbeitnowJob[] })),
    ),
  );
  return pages.flatMap(p =>
    p.data.map(
      (j): Job => ({
        id: `arbeitnow:${j.slug}`,
        source: 'arbeitnow',
        title: j.title,
        company: j.company_name,
        location: j.location || (j.remote ? 'Remote' : 'Germany'),
        remote: j.remote,
        tags: [...j.tags, ...j.job_types],
        url: j.url,
        postedAt: new Date(j.created_at * 1000).toISOString(),
        description: htmlToText(j.description),
      }),
    ),
  );
}

export const arbeitnow: SourceAdapter = {
  name: 'arbeitnow',
  label: 'Arbeitnow',
  enabled: () => true,
  search: () => cached('arbeitnow:feed', TTL, loadFeed),
};
