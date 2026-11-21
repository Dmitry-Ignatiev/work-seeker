import { cached, getJson } from '../http';
import { isIsraelLocation } from '../location';
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

/**
 * Search parameters, Israel by default: JSearch searches the US unless told otherwise, so every request sets
 * country=il, and a search without a city says "in Israel". Remote searches stay in Israel too (remote roles
 * open to people here), with JSearch's work-from-home filter on.
 */
export function jsearchParams({ query, location, remoteOnly }: { query: string; location?: string; remoteOnly?: boolean }) {
  const place = location?.trim();
  const inIsrael = !place || /remote|anywhere|israel|ישראל|מרחוק/i.test(place) ? 'Israel' : `${place}, Israel`;
  const params = new URLSearchParams({ query: `${query} in ${inIsrael}`, num_pages: '1', country: 'il' });
  if (remoteOnly || (place && /remote|מרחוק/i.test(place))) params.set('work_from_home', 'true');
  return params;
}

/**
 * A readable location. Cities often come in Hebrew ("יפו") with the country as a code ("IL"), so the code is
 * spelled out: "יפו, Israel". Google sometimes labels Israeli cities with country "US" ("Tel Aviv-Yafo, US");
 * those are corrected to Israel.
 */
export function jsearchLocation(j: Pick<JSearchJob, 'job_city' | 'job_state' | 'job_country' | 'job_is_remote'>): string {
  const place = [j.job_city, j.job_state].filter(Boolean).join(', ');
  const mislabeled = j.job_country === 'US' && isIsraelLocation(place);
  const israel = j.job_country === 'IL' || mislabeled;
  const country = israel ? 'Israel' : j.job_country;
  // No repeats ("Israel, Israel") and, in Israel, no district codes ("JM", "M").
  const parts: string[] = [];
  for (const part of [j.job_city, j.job_state, country]) {
    if (!part || (israel && part !== country && /^[A-Z]{1,2}$/.test(part))) continue;
    if (!parts.some(p => p.toLowerCase() === part.toLowerCase())) parts.push(part);
  }
  return parts.join(', ') || (j.job_is_remote ? 'Remote' : 'Unknown');
}

/** JSearch (RapidAPI): aggregates Google for Jobs (LinkedIn, Indeed, Glassdoor…). Needs JSEARCH_API_KEY. */
export const jsearch: SourceAdapter = {
  name: 'jsearch',
  label: 'JSearch',
  enabled: () => Boolean(process.env.JSEARCH_API_KEY),
  // Google for Jobs answers in 4–12 s; the other sources' 8 s cut it off half the time.
  timeoutMs: 15_000,
  async search(input) {
    const params = jsearchParams(input);
    // JSearch v5: /search-v2 returns { data: { jobs, cursor } } (the old /search returned { data: [...] }).
    const data = await cached(`jsearch:${params}`, TTL, () =>
      getJson<{ data: { jobs?: JSearchJob[] } | JSearchJob[] }>(`https://jsearch.p.rapidapi.com/search-v2?${params}`, {
        headers: {
          'X-RapidAPI-Key': process.env.JSEARCH_API_KEY!,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
        },
      }),
    );
    const jobs = Array.isArray(data.data) ? data.data : (data.data?.jobs ?? []);
    return jobs.map(
      (j): Job => {
        const cur = j.job_salary_currency;
        const symbol = !cur || cur === 'USD' ? '$' : `${cur} `;
        return {
          id: `jsearch:${j.job_id}`,
          source: 'jsearch',
          title: j.job_title,
          company: j.employer_name,
          location: jsearchLocation(j),
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
