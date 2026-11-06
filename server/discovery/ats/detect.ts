import type { Ats } from './boards';

export type DetectedSource =
  | { kind: 'board'; ats: Ats; slug: string; jobId?: string }
  | { kind: 'gotfriends'; jobId?: string };

/** Recognises company-board and GotFriends links (pure). Returns null for anything else. */
export function detectJobSource(url: URL): DetectedSource | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io' || host === 'job-boards.eu.greenhouse.io') {
    if (segments[0] === 'embed') {
      const slug = url.searchParams.get('for');
      return slug ? { kind: 'board', ats: 'greenhouse', slug, jobId: url.searchParams.get('token') ?? undefined } : null;
    }
    if (!segments[0]) return null;
    const jobId = segments[1] === 'jobs' && /^\d+$/.test(segments[2] ?? '') ? segments[2] : undefined;
    return { kind: 'board', ats: 'greenhouse', slug: segments[0], jobId };
  }
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    if (!segments[0]) return null;
    return { kind: 'board', ats: 'lever', slug: segments[0], jobId: segments[1] };
  }
  if (host === 'jobs.ashbyhq.com') {
    if (!segments[0]) return null;
    return { kind: 'board', ats: 'ashby', slug: segments[0], jobId: segments[1] };
  }
  if (host === 'gotfriends.co.il' && segments[0] === 'jobslobby') {
    const last = segments.at(-1);
    return { kind: 'gotfriends', jobId: last && /^\d+$/.test(last) ? last : undefined };
  }
  return null;
}
