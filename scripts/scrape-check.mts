/**
 * Live canary for every job source: run before a demo or a deploy.
 *   npm run scrape:check
 * Makes a handful of real requests (politely), prints counts, exits 1 if a core source is broken.
 * Writes nothing to the database.
 */
import { config } from 'dotenv';
import careerSources from '../prisma/seed-data/career-sources.json' with { type: 'json' };
import { fetchBoard, type Ats } from '../server/discovery/ats/boards';
import { isIsraelLocation } from '../server/discovery/location';
import { arbeitnow } from '../server/discovery/sources/arbeitnow';
import { jsearch } from '../server/discovery/sources/jsearch';
import { remoteok } from '../server/discovery/sources/remoteok';
import { fetchGotFriendsJob, gotfriends } from '../server/discovery/scrape/gotfriends';

config({ path: ['.env.local', '.env'], quiet: true });

let failed = false;
const line = (ok: boolean, name: string, detail: string) => {
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${name.padEnd(22)} ${detail}`);
};

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = Date.now();
  const value = await fn();
  return [value, Date.now() - start];
}

async function checkGotFriends() {
  try {
    const [jobs, ms] = await timed(() => gotfriends.search({ query: 'backend developer' }));
    line(jobs.length > 0, 'GotFriends listing', `${jobs.length} jobs in ${ms} ms${jobs[0] ? ` · e.g. "${jobs[0].title}"` : ''}`);
    if (jobs[0]) {
      const page = await fetchGotFriendsJob(jobs[0].url);
      const length = page.description?.length ?? 0;
      line(length > 200, 'GotFriends job page', `${length} chars, location: ${page.location ?? '?'}, requirements: ${/דרישות/.test(page.description ?? '') ? 'yes' : 'no'}`);
    }
  } catch (error) {
    line(false, 'GotFriends', (error as Error).message);
  }
}

async function checkBoards() {
  const boards = careerSources.boards;
  const results: { name: string; total: number; israel: number; error?: string }[] = [];
  const queue = [...boards];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let b = queue.shift(); b; b = queue.shift()) {
        try {
          const jobs = await fetchBoard({ ats: b.ats as Ats, slug: b.slug, companyName: b.companyName });
          results.push({ name: b.companyName, total: jobs.length, israel: jobs.filter(j => isIsraelLocation(j.location)).length });
        } catch (error) {
          results.push({ name: b.companyName, total: 0, israel: 0, error: (error as Error).message });
        }
      }
    }),
  );
  const broken = results.filter(r => r.error);
  const israel = results.reduce((sum, r) => sum + r.israel, 0);
  line(broken.length <= boards.length * 0.2, 'Company boards', `${boards.length - broken.length}/${boards.length} answered, ${israel} roles in Israel`);
  for (const r of broken) console.log(`    ✗ ${r.name}: ${r.error}`);
  for (const r of results.filter(r => !r.error && r.israel === 0)) console.log(`    · ${r.name}: no Israeli roles right now`);
}

async function checkFeed(name: string, run: () => Promise<unknown[]>, core = false) {
  try {
    const [jobs, ms] = await timed(run);
    line(jobs.length > 0 || !core, name, `${jobs.length} jobs in ${ms} ms`);
  } catch (error) {
    line(!core, name, (error as Error).message);
  }
}

console.log('Checking job sources (live)…\n');
await Promise.all([checkGotFriends(), checkBoards()]);
await checkFeed('Remote OK', () => remoteok.search({ query: '' }));
await checkFeed('Arbeitnow', () => arbeitnow.search({ query: '' }));
if (jsearch.enabled()) await checkFeed('JSearch', () => jsearch.search({ query: 'software engineer', location: 'Israel' }));
else console.log('· JSearch                 skipped (no JSEARCH_API_KEY)');

console.log(failed ? '\nSome sources are broken.' : '\nAll core sources work.');
process.exit(failed ? 1 : 0);
