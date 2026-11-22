import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job, SourceAdapter } from '@/server/discovery/types';

// Company boards are fetched over the network: fake them.
const fetchBoard = vi.hoisted(() => vi.fn<(board: { slug: string; companyName: string }) => Promise<Job[]>>());
vi.mock('@/server/discovery/ats/boards', async importOriginal => ({
  ...(await importOriginal<typeof import('@/server/discovery/ats/boards')>()),
  fetchBoard,
}));

const { db } = await import('@/server/db');
const { NotFoundError } = await import('@/server/errors');
const jobs = await import('@/server/services/jobs');
const { createTestUser, resetDatabase } = await import('../support/db');

const job = (over: Partial<Job> & Pick<Job, 'id' | 'source'>): Job => ({
  title: 'Backend Engineer',
  company: 'Acme',
  location: 'Tel Aviv, Israel',
  remote: false,
  tags: [],
  url: `https://jobs.example.com/${over.id}`,
  description: 'We build backend services in Go and Node.js.',
  ...over,
});

const adapter = (label: string, search: SourceAdapter['search']): SourceAdapter => ({
  name: 'jsearch',
  label,
  enabled: () => true,
  search,
});

describe('jobs service', () => {
  beforeEach(async () => {
    await resetDatabase();
    fetchBoard.mockReset();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe('searchJobs', () => {
    it('merges sources, keeps Israeli roles, leaves remote ones out unless asked, dedupes, and saves', async () => {
      const telAviv = job({ id: 'jsearch:1', source: 'jsearch', postedAt: '2026-11-05T00:00:00Z' });
      const london = job({ id: 'jsearch:2', source: 'jsearch', location: 'London' });
      const remote = job({ id: 'remoteok:3', source: 'remoteok', title: 'Backend Developer', location: 'Worldwide', remote: true });
      const sameRoleElsewhere = job({ id: 'arbeitnow:4', source: 'arbeitnow', title: 'Backend  engineer' });
      const sources = [
        adapter('Google for Jobs', async () => [telAviv, london]),
        adapter('Remote OK', async () => [remote]),
        adapter('Broken board', async () => {
          throw new Error('boom');
        }),
        adapter('Arbeitnow', async () => [sameRoleElsewhere]),
      ];

      const result = await jobs.searchJobs({ query: 'backend' }, { sources });

      expect(result.jobs.map(j => j.title)).toEqual(['Backend Engineer']);
      expect(result.sources).toEqual([
        { source: 'Google for Jobs', ok: true, found: 1 },
        { source: 'Remote OK', ok: true, found: 0 },
        { source: 'Broken board', ok: false, found: 0, error: 'unavailable right now' },
        { source: 'Arbeitnow', ok: true, found: 0 },
      ]);

      // The same search again updates the saved rows instead of duplicating them.
      const again = await jobs.searchJobs({ query: 'backend' }, { sources });
      expect(again.jobs.map(j => j.id).sort()).toEqual(result.jobs.map(j => j.id).sort());
      expect(await db.job.count()).toBe(1);
    });

    it('honours remoteOnly', async () => {
      const sources = [
        adapter('A', async () => [
          job({ id: 'jsearch:1', source: 'jsearch' }),
          job({ id: 'jsearch:2', source: 'jsearch', title: 'Backend Engineer (Remote)', location: 'Remote', remote: true }),
        ]),
      ];
      const result = await jobs.searchJobs({ query: 'backend', remoteOnly: true }, { sources });
      expect(result.jobs.map(j => j.remote)).toEqual([true]);
      // Saying "remote" as the place works the same way.
      const asked = await jobs.searchJobs({ query: 'backend', location: 'Remote' }, { sources });
      expect(asked.jobs.map(j => j.remote)).toEqual([true]);
    });

    it('keeps only jobs in the city or region asked for', async () => {
      const sources = [
        adapter('A', async () => [
          job({ id: 'jsearch:1', source: 'jsearch', title: 'Backend Engineer', location: 'Tel Aviv, Israel' }),
          job({ id: 'jsearch:2', source: 'jsearch', title: 'Backend Developer', location: 'Jerusalem, Israel' }),
          job({ id: 'jsearch:3', source: 'jsearch', title: 'Backend Lead', location: 'Petah Tikva, Israel' }),
          job({ id: 'jsearch:4', source: 'jsearch', title: 'Backend Dev', location: 'Remote - EMEA', remote: true }),
        ]),
      ];
      const titles = async (location: string) =>
        (await jobs.searchJobs({ query: 'backend', location }, { sources })).jobs.map(j => j.title).sort();
      expect(await titles('Jerusalem')).toEqual(['Backend Developer']);
      expect(await titles('Center')).toEqual(['Backend Engineer', 'Backend Lead']);
      expect(await titles('Israel')).toEqual(['Backend Developer', 'Backend Engineer', 'Backend Lead']);
    });

    it('limits a search to one job site through Google for Jobs, and names the site on each card', async () => {
      const jsearchSource = adapter('JSearch', async () => [
        job({ id: 'jsearch:1', source: 'jsearch', title: 'QA Engineer', url: 'https://il.linkedin.com/jobs/view/1' }),
        job({ id: 'jsearch:2', source: 'jsearch', title: 'QA Lead', url: 'https://www.gotfriends.co.il/jobslobby/qa/2/' }),
      ]);
      const boards = {
        ...adapter('Company careers pages', async () => [job({ id: 'greenhouse:a:3', source: 'greenhouse', title: 'QA Tester' })]),
        name: 'greenhouse' as const,
      };

      const linkedin = await jobs.searchJobs({ query: 'qa', site: 'linkedin' }, { sources: [jsearchSource, boards] });
      expect(linkedin.jobs.map(j => [j.title, j.source])).toEqual([['QA Engineer', 'LinkedIn']]);
      expect(linkedin.sources.map(s => s.source)).toEqual(['JSearch']);

      const all = await jobs.searchJobs({ query: 'qa' }, { sources: [jsearchSource, boards] });
      expect(all.jobs.map(j => j.source).sort()).toEqual(['Company careers page', 'GotFriends', 'LinkedIn']);
    });

    it('shows jobs elsewhere in Israel, and says so, when the place asked for has none', async () => {
      const sources = [
        adapter('A', async () => [
          job({ id: 'jsearch:1', source: 'jsearch', title: 'Backend Engineer', location: 'Rehovot, Israel' }),
          job({ id: 'jsearch:2', source: 'jsearch', title: 'Backend Dev', location: 'Remote', remote: true }),
        ]),
      ];
      const south = await jobs.searchJobs({ query: 'backend', location: 'South' }, { sources });
      expect(south.widenedFrom).toBe('South');
      expect(south.jobs.map(j => j.title)).toEqual(['Backend Engineer']);
      // A place with matches isn't widened.
      const center = await jobs.searchJobs({ query: 'backend', location: 'Center' }, { sources });
      expect(center.widenedFrom).toBeUndefined();
    });
  });

  describe('company boards', () => {
    async function seedBoard() {
      return db.careerSource.create({ data: { ats: 'GREENHOUSE', slug: 'acme', companyName: 'Acme' } });
    }

    it('stores Israeli and remote roles, then closes roles that leave the board', async () => {
      const source = await seedBoard();
      const il = job({ id: 'greenhouse:acme:1', source: 'greenhouse' });
      const remote = job({ id: 'greenhouse:acme:2', source: 'greenhouse', title: 'Backend Engineer, EMEA', location: 'Remote', remote: true });
      const nyc = job({ id: 'greenhouse:acme:3', source: 'greenhouse', location: 'New York' });
      fetchBoard.mockResolvedValueOnce([il, remote, nyc]);

      expect(await jobs.refreshBoard(source)).toBe(2);
      expect(await db.job.count({ where: { careerSourceId: source.id, closedAt: null } })).toBe(2);

      fetchBoard.mockResolvedValueOnce([il]);
      await jobs.refreshBoard(source);
      const closed = await db.job.findFirstOrThrow({ where: { sourceJobId: 'acme:2' } });
      expect(closed.closedAt).not.toBeNull();

      // Fresh boards are searched from the database, without fetching again.
      const found = await jobs.companyBoards.search({ query: 'backend' });
      expect(found.map(j => j.id)).toEqual(['greenhouse:acme:1']);
      expect(fetchBoard).toHaveBeenCalledTimes(2);
    });

    it('records a failing board instead of throwing from a search', async () => {
      await seedBoard();
      fetchBoard.mockRejectedValueOnce(new Error('boards-api.greenhouse.io responded 404'));
      await expect(jobs.companyBoards.search({ query: 'backend' })).resolves.toEqual([]);
      const source = await db.careerSource.findFirstOrThrow();
      expect(source.lastError).toContain('404');
    });

    it('follows a company from its careers link', async () => {
      const user = await createTestUser();
      fetchBoard.mockResolvedValue([job({ id: 'lever:newco:9', source: 'lever', title: 'QA Engineer' })]);

      const result = await jobs.followCompany(user.id, 'https://jobs.lever.co/newco', 'NewCo');
      expect(result).toEqual({ status: 'OK', companyName: 'NewCo', openRoles: 1, alreadyFollowed: false });
      expect(await db.careerSource.findFirstOrThrow()).toMatchObject({ ats: 'LEVER', slug: 'newco', addedByUserId: user.id });

      expect(await jobs.followCompany(user.id, 'https://example.com/careers')).toMatchObject({ status: 'UNSUPPORTED' });
    });
  });

  describe('adding a job by link or text', () => {
    const description = 'Senior Backend Engineer at Acme in Tel Aviv. '.repeat(10);

    it('keeps pasted jobs private to their owner', async () => {
      const alice = await createTestUser();
      const bob = await createTestUser();
      const added = await jobs.addJobFromText(alice.id, { text: description, title: 'Senior Backend Engineer', company: 'Acme' });
      if (added.status !== 'OK') throw new Error(added.status);

      expect(added.job).toMatchObject({ title: 'Senior Backend Engineer', company: 'Acme', source: 'Description you pasted' });
      await expect(jobs.getJobForUser(bob.id, added.job.id)).rejects.toThrow(NotFoundError);
      await expect(jobs.getJobForUser(alice.id, added.job.id)).resolves.toMatchObject({ ownerUserId: alice.id });

      const again = await jobs.addJobFromText(alice.id, { text: description });
      expect(again).toMatchObject({ status: 'OK', job: { id: added.job.id } });
    });

    it('rejects descriptions that are too short', async () => {
      const user = await createTestUser();
      expect(await jobs.addJobFromText(user.id, { text: 'Backend dev' })).toMatchObject({ status: 'INVALID' });
    });

    it('asks for a paste for LinkedIn links, without fetching them', async () => {
      const user = await createTestUser();
      expect(await jobs.addJobFromUrl(user.id, 'https://www.linkedin.com/jobs/view/123')).toMatchObject({ status: 'NEEDS_PASTE' });
      expect(await jobs.addJobFromUrl(user.id, 'not a link')).toMatchObject({ status: 'INVALID' });
    });
  });
});
