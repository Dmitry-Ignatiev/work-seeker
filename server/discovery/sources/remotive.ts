import { cached, getJson } from '../http';
import { htmlToText } from '../text';
import type { Job, SourceAdapter } from '../types';

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  tags: string[];
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
}

// Remotive asks clients not to poll more than a few times a day.
// Disabled by default: its terms forbid showing its jobs on sites that collect signups.
const TTL = 6 * 60 * 60 * 1000;

export const remotive: SourceAdapter = {
  name: 'remotive',
  label: 'Remotive',
  enabled: () => process.env.ENABLE_REMOTIVE === 'true',
  async search({ query }) {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=50`;
    const data = await cached(url, TTL, () => getJson<{ jobs: RemotiveJob[] }>(url));
    return data.jobs.map(
      (j): Job => ({
        id: `remotive:${j.id}`,
        source: 'remotive',
        title: j.title,
        company: j.company_name.trim(),
        location: j.candidate_required_location || 'Remote',
        remote: true,
        salary: j.salary || undefined,
        tags: [...(j.tags ?? []), j.job_type].filter(Boolean),
        url: j.url,
        postedAt: j.publication_date,
        description: htmlToText(j.description),
      }),
    );
  },
};
