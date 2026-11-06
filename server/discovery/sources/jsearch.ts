import { cached, getJson } from '../http';
import { formatSalary } from '../text';
import type { Job, SourceAdapter } from '../types';

interface JSearchJob {
  job_id: string;
  job_title: string;
  employer_name: string;
  job_publisher?: string;
  job_employment_type?: string;
  job_apply_link: string;
  job_description: string;
  job_is_remote?: boolean;
  job_city?: string;
  job_state?: string;
  job_country?: string;
  job_posted_at_datetime_utc?: string;
  job_min_salary?: number | null;
  job_max_salary?: number | null;
  job_salary_currency?: string | null;
}

const TTL = 30 * 60 * 1000;

/** JSearch (RapidAPI): aggregates Google for Jobs (LinkedIn, Indeed, Glassdoor…). Needs JSEARCH_API_KEY. */
export const jsearch: SourceAdapter = {
  name: 'jsearch',
  label: 'JSearch',
  enabled: () => Boolean(process.env.JSEARCH_API_KEY),
  async search({ query, location, remoteOnly }) {
    const q = location ? `${query} in ${location}` : query;
    const params = new URLSearchParams({ query: q, page: '1', num_pages: '1' });
    if (remoteOnly) params.set('work_from_home', 'true');
    const data = await cached(`jsearch:${params}`, TTL, () =>
      getJson<{ data: JSearchJob[] }>(`https://jsearch.p.rapidapi.com/search?${params}`, {
        headers: {
          'X-RapidAPI-Key': process.env.JSEARCH_API_KEY!,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
        },
      }),
    );
    return (data.data ?? []).map(
      (j): Job => {
        const cur = j.job_salary_currency;
        const symbol = !cur || cur === 'USD' ? '$' : `${cur} `;
        return {
          id: `jsearch:${j.job_id}`,
          source: 'jsearch',
          title: j.job_title,
          company: j.employer_name,
          location:
            [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') ||
            (j.job_is_remote ? 'Remote' : 'Unknown'),
          remote: Boolean(j.job_is_remote),
          salary: formatSalary(j.job_min_salary, j.job_max_salary, symbol),
          tags: [j.job_employment_type, j.job_publisher].filter(Boolean) as string[],
          url: j.job_apply_link,
          postedAt: j.job_posted_at_datetime_utc,
          description: j.job_description,
        };
      },
    );
  },
};
