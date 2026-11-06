import { cached, getJson } from '../http';
import { fixMojibake, formatSalary, htmlToText } from '../text';
import type { Job, SourceAdapter } from '../types';

interface RemoteOkJob {
  id?: string;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
}

const TTL = 60 * 60 * 1000;

/** RemoteOK returns its latest ~100 jobs; filter locally. The first element is a legal notice. */
async function loadFeed(): Promise<Job[]> {
  const data = await getJson<RemoteOkJob[]>('https://remoteok.com/api');
  return data
    .filter(j => j.id && j.position)
    .map(
      (j): Job => ({
        id: `remoteok:${j.id}`,
        source: 'remoteok',
        title: fixMojibake(j.position!),
        company: fixMojibake(j.company ?? ''),
        location: fixMojibake(j.location || 'Remote'),
        remote: true,
        salary: formatSalary(j.salary_min, j.salary_max),
        tags: j.tags ?? [],
        url: j.url ?? j.apply_url ?? 'https://remoteok.com',
        postedAt: j.date,
        description: fixMojibake(htmlToText(j.description)),
      }),
    );
}

export const remoteok: SourceAdapter = {
  name: 'remoteok',
  label: 'Remote OK',
  enabled: () => true,
  search: () => cached('remoteok:feed', TTL, loadFeed),
};
