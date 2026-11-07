import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { NotFoundError } from '@/server/errors';
import { createCv } from '@/server/services/cv';
import { addJobFromText } from '@/server/services/jobs';
import { confirmExperience, getTailoredCvForDownload, tailorCvForJob } from '@/server/services/tailor';
import { buildCvDocx } from '@/server/tailor/docx';
import { SAMPLE_CV_LINES } from '../support/make-pdf';
import { createTestUser, resetDatabase } from '../support/db';

// AI_MOCK=1: the default offline responders extract known technologies, split the CV into bullets, and
// propose one truthful edit (Node.js, which the CV has) and one the guard must refuse (AWS, which it doesn't).

const JOB_TEXT =
  'Senior Backend Engineer at Acme Robotics. Build backend services in Node.js and TypeScript on AWS. ' +
  '5+ years of backend experience. PostgreSQL, Docker. We value ownership, clear communication and pragmatic engineering. ' +
  'Hybrid work from our Tel Aviv office.';

async function seedSkills() {
  for (const [canonicalName, aliases] of [
    ['Node.js', ['node.js', 'nodejs', 'node']],
    ['TypeScript', ['typescript', 'ts']],
    ['AWS', ['aws', 'amazon web services']],
    ['PostgreSQL', ['postgresql', 'postgres']],
    ['Docker', ['docker']],
    ['React', ['react']],
  ] as const) {
    await db.skill.create({ data: { canonicalName, aliases: { create: aliases.map(alias => ({ alias })) } } });
  }
}

async function userWithCvAndJob() {
  const user = await createTestUser();
  await createCv(user.id, { fileName: 'cv.pdf', sizeBytes: 1000, pageCount: 1, text: SAMPLE_CV_LINES.join('\n') });
  const added = await addJobFromText(user.id, { text: JOB_TEXT, title: 'Senior Backend Engineer', company: 'Acme Robotics' });
  if (added.status !== 'OK') throw new Error(added.status);
  return { user, jobId: added.job.id };
}

describe('CV tailoring', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedSkills();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('asks for a CV first', async () => {
    const user = await createTestUser();
    const added = await addJobFromText(user.id, { text: JOB_TEXT });
    if (added.status !== 'OK') throw new Error(added.status);
    expect(await tailorCvForJob(user.id, added.job.id)).toEqual({ status: 'NEEDS_CV' });
  });

  it('keeps the truthful edit, refuses the invented one, and saves the result', async () => {
    const { user, jobId } = await userWithCvAndJob();
    const result = await tailorCvForJob(user.id, jobId);
    if (result.status !== 'OK') throw new Error(result.status);

    expect(result.changes).toEqual([
      expect.objectContaining({
        before: 'Built TypeScript and React dashboards used by 40,000 customers.',
        after: 'Built TypeScript and React dashboards with a Node.js backend used by 40,000 customers.',
        keywords: ['Node.js'],
      }),
    ]);
    expect(result.rejected).toEqual([expect.objectContaining({ reason: '"AWS" isn\'t in your CV' })]);
    expect(result.missing).toEqual(['AWS']);
    expect(result).toMatchObject({ keywordTotal: 5, coverageBefore: 4, coverageAfter: 4 });
    expect(result.downloadUrl).toBe(`/api/tailored-cvs/${result.id}/docx`);

    const saved = await db.tailoredCv.findUniqueOrThrow({ where: { id: result.id } });
    expect(saved.missing).toEqual(['AWS']);
    const runs = await db.aiRun.groupBy({ by: ['kind'], _count: true });
    expect(Object.fromEntries(runs.map(r => [r.kind, r._count]))).toEqual({ EXTRACT_REQUIREMENTS: 1, PARSE_CV: 1, TAILOR_CV: 1 });
  });

  it('reuses the job keywords and the CV structure on the next tailoring', async () => {
    const { user, jobId } = await userWithCvAndJob();
    await tailorCvForJob(user.id, jobId);
    await tailorCvForJob(user.id, jobId);
    const runs = await db.aiRun.groupBy({ by: ['kind'], _count: true });
    expect(Object.fromEntries(runs.map(r => [r.kind, r._count]))).toEqual({ EXTRACT_REQUIREMENTS: 1, PARSE_CV: 1, TAILOR_CV: 2 });
  });

  it('uses experience the user confirmed', async () => {
    const { user, jobId } = await userWithCvAndJob();
    await confirmExperience(user.id, 'AWS', 'Two years running our services on AWS at Acme.');
    const result = await tailorCvForJob(user.id, jobId);
    if (result.status !== 'OK') throw new Error(result.status);
    expect(result.rejected).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.changes.map(c => c.keywords)).toEqual([['Node.js'], ['AWS']]);
    expect(result.coverageAfter).toBe(5);
  });

  it("never shows one user's tailored CV or private job to another", async () => {
    const { user: alice, jobId } = await userWithCvAndJob();
    const result = await tailorCvForJob(alice.id, jobId);
    if (result.status !== 'OK') throw new Error(result.status);

    const bob = await createTestUser();
    await createCv(bob.id, { fileName: 'bob.pdf', sizeBytes: 1000, pageCount: 1, text: SAMPLE_CV_LINES.join('\n') });
    await expect(getTailoredCvForDownload(bob.id, result.id)).rejects.toThrow(NotFoundError);
    expect(await tailorCvForJob(bob.id, jobId)).toEqual({ status: 'JOB_NOT_FOUND' }); // Alice's pasted job is private
  });

  it('renders a DOCX with the tailored bullets and contact details from the CV', async () => {
    const { user, jobId } = await userWithCvAndJob();
    const result = await tailorCvForJob(user.id, jobId);
    if (result.status !== 'OK') throw new Error(result.status);

    const cv = await getTailoredCvForDownload(user.id, result.id);
    expect(cv.contact[0]).toBe('dana.levi@example.com');
    expect(cv.fileName).toBe('Test User - CV for Senior Backend Engineer at Acme Robotics');
    const buffer = await buildCvDocx(cv);
    expect(buffer.subarray(0, 2).toString()).toBe('PK'); // a .docx is a zip
    expect(buffer.length).toBeGreaterThan(3_000);
  });
});
