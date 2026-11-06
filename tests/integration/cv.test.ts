import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { NotFoundError } from '@/server/errors';
import { countCvs, createCv, deleteCv, listCvs, setDefaultCv } from '@/server/services/cv';
import { SAMPLE_CV_LINES } from '../support/make-pdf';
import { createTestUser, resetDatabase } from '../support/db';

const cvInput = (text = SAMPLE_CV_LINES.join('\n'), fileName = 'Dana CV.pdf') => ({
  fileName,
  sizeBytes: 12_345,
  pageCount: 1,
  text,
});

async function seedSkills() {
  const skills: [string, string[], boolean?][] = [
    ['TypeScript', ['typescript', 'ts']],
    ['React', ['react']],
    ['Node.js', ['node.js', 'nodejs']],
    ['Go', ['go'], false],
  ];
  for (const [canonicalName, aliases, textScan = true] of skills) {
    await db.skill.create({
      data: { canonicalName, aliases: { create: aliases.map(alias => ({ alias, textScan })) } },
    });
  }
}

describe('CV service', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedSkills();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('stores the text and the skills it mentions, and makes the first CV the default', async () => {
    const user = await createTestUser();
    const { id, duplicate } = await createCv(user.id, cvInput(`${SAMPLE_CV_LINES.join('\n')}\nLet's go!`));

    expect(duplicate).toBe(false);
    const [cv] = await listCvs(user.id);
    expect(cv).toMatchObject({ id, label: 'Dana CV', fileName: 'Dana CV.pdf', isDefault: true, pageCount: 1 });
    // "go" is exact-match only (textScan=false), so "Let's go!" is not a Go skill.
    expect(cv.skills.sort()).toEqual(['Node.js', 'React', 'TypeScript']);
    const row = await db.cv.findUniqueOrThrow({ where: { id } });
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.status).toBe('PARSED');
  });

  it('returns the existing CV when the same text is uploaded again', async () => {
    const user = await createTestUser();
    const first = await createCv(user.id, cvInput());
    const again = await createCv(user.id, cvInput(undefined, 'renamed.pdf'));

    expect(again).toEqual({ id: first.id, duplicate: true });
    expect(await countCvs(user.id)).toBe(1);
  });

  it('keeps one default, and promotes the newest CV when the default is deleted', async () => {
    const user = await createTestUser();
    const a = await createCv(user.id, cvInput('first CV text '.repeat(20), 'a.pdf'));
    const b = await createCv(user.id, cvInput('second CV text '.repeat(20), 'b.pdf'));
    const c = await createCv(user.id, cvInput('third CV text '.repeat(20), 'c.pdf'));

    await setDefaultCv(user.id, b.id);
    let cvs = await listCvs(user.id);
    expect(cvs.filter(cv => cv.isDefault).map(cv => cv.id)).toEqual([b.id]);

    await deleteCv(user.id, b.id);
    cvs = await listCvs(user.id);
    expect(cvs.map(cv => cv.id).sort()).toEqual([a.id, c.id].sort());
    expect(cvs.find(cv => cv.isDefault)?.id).toBe(c.id);
    expect(await db.cvSkill.count({ where: { cvId: b.id } })).toBe(0);
  });

  it("never lets one user see or change another user's CVs", async () => {
    const alice = await createTestUser({ name: 'Alice' });
    const bob = await createTestUser({ name: 'Bob' });
    const alicesCv = await createCv(alice.id, cvInput());
    await createCv(bob.id, cvInput('Bob is a Go developer. '.repeat(10)));

    expect((await listCvs(bob.id)).map(cv => cv.id)).not.toContain(alicesCv.id);
    await expect(deleteCv(bob.id, alicesCv.id)).rejects.toThrow(NotFoundError);
    await expect(setDefaultCv(bob.id, alicesCv.id)).rejects.toThrow(NotFoundError);
    // Bob's failed setDefault must not have touched his own default either.
    expect((await listCvs(bob.id)).filter(cv => cv.isDefault)).toHaveLength(1);
    expect(await countCvs(alice.id)).toBe(1);
  });

  it('lets two users upload the same CV text independently', async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const a = await createCv(alice.id, cvInput());
    const b = await createCv(bob.id, cvInput());
    expect(a.duplicate || b.duplicate).toBe(false);
    expect(a.id).not.toBe(b.id);
  });

  it('removes CVs when the user is deleted', async () => {
    const user = await createTestUser();
    await createCv(user.id, cvInput());
    await db.user.delete({ where: { id: user.id } });
    expect(await db.cv.count()).toBe(0);
    expect(await db.cvSkill.count()).toBe(0);
  });
});
