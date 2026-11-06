import { cached, getJson } from '../http';
import { formatSalary, htmlToText } from '../text';
import type { Job, SourceAdapter } from '../types';

interface AdzunaJob {
  id: string;
  title: string;
  description: string;
  redirect_url: string;
  created: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  salary_min?: number;
  salary_max?: number;
  contract_time?: string;
  category?: { label?: string };
}

const TTL = 30 * 60 * 1000;
const CURRENCY: Record<string, string> = {
  gb: '£', de: '€', fr: '€', nl: '€', it: '€', es: '€', at: '€', be: '€', pl: 'zł ', in: '₹',
};

/** Adzuna: on-site/hybrid jobs by country. Needs ADZUNA_APP_ID + ADZUNA_APP_KEY (free at developer.adzuna.com). */
export const adzuna: SourceAdapter = {
  name: 'adzuna',
  label: 'Adzuna',
  enabled: () => Boolean(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
  async search({ query, location, country }) {
    const cc = (country || process.env.ADZUNA_DEFAULT_COUNTRY || 'us').toLowerCase();
    const params = new URLSearchParams({
      app_id: process.env.ADZUNA_APP_ID!,
      app_key: process.env.ADZUNA_APP_KEY!,
      what: query,
      results_per_page: '40',
    });
    if (location) params.set('where', location);
    const url = `https://api.adzuna.com/v1/api/jobs/${cc}/search/1?${params}`;
    const data = await cached(`adzuna:${cc}:${query}:${location ?? ''}`, TTL, () =>
      getJson<{ results: AdzunaJob[] }>(url),
    );
    return data.results.map(
      (j): Job => ({
        id: `adzuna:${j.id}`,
        source: 'adzuna',
        title: htmlToText(j.title),
        company: j.company?.display_name ?? 'Unknown',
        location: j.location?.display_name ?? cc.toUpperCase(),
        remote: /remote/i.test(`${j.title} ${j.description}`),
        salary: formatSalary(j.salary_min, j.salary_max, CURRENCY[cc] ?? '$'),
        tags: [j.category?.label, j.contract_time].filter(Boolean) as string[],
        url: j.redirect_url,
        postedAt: j.created,
        description: htmlToText(j.description),
      }),
    );
  },
};
