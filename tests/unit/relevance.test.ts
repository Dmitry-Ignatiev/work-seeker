import { describe, expect, it } from 'vitest';
import { judgeJob, placeMatches, summarize, type RelevanceCase } from '@/server/discovery/relevance';

const now = new Date('2026-11-21T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const job = (over: Partial<Parameters<typeof judgeJob>[1]> = {}) => ({
  title: 'QA Automation Engineer',
  company: 'Acme',
  location: 'Tel Aviv, Israel',
  remote: false,
  postedAt: daysAgo(3),
  source: 'Company careers page',
  ...over,
});
const qaTelAviv: RelevanceCase = {
  name: 'QA',
  search: { query: 'qa automation engineer', location: 'Tel Aviv' },
  roleTitle: [/\bqa\b|automation|test/i],
  region: 'tel-aviv',
};

describe('judgeJob', () => {
  it('passes a job with the right role, place and age', () => {
    expect(judgeJob(qaTelAviv, job(), now)).toMatchObject({ relevant: true, problems: [] });
  });

  it('names every problem in plain words', () => {
    const judged = judgeJob(qaTelAviv, job({ title: 'Product Manager', location: 'Haifa', postedAt: daysAgo(90) }), now);
    expect(judged.relevant).toBe(false);
    expect(judged.problems).toEqual(['different role', 'not in tel-aviv', 'posted 90 days ago']);
  });

  it('checks the level only when the case asks for one', () => {
    const junior: RelevanceCase = { ...qaTelAviv, level: 'junior' };
    expect(judgeJob(junior, job({ title: 'Senior QA Automation Engineer' }), now).problems).toEqual(['not junior']);
    expect(judgeJob(qaTelAviv, job({ title: 'Senior QA Automation Engineer' }), now).checks.level).toBeNull();
  });

  it('does not count an unknown posting date against a job', () => {
    expect(judgeJob(qaTelAviv, job({ postedAt: null }), now).checks.fresh).toBeNull();
  });
});

describe('placeMatches', () => {
  it('knows the regions', () => {
    expect(placeMatches('center', { location: 'Petah Tikva', remote: false })).toBe(true);
    expect(placeMatches('center', { location: 'Haifa', remote: false })).toBe(false);
    expect(placeMatches('haifa-north', { location: 'Yokneam, Israel', remote: false })).toBe(true);
    expect(placeMatches('israel', { location: 'Berlin, Germany', remote: false })).toBe(false);
  });

  it('accepts open remote roles but not remote roles tied to another country', () => {
    expect(placeMatches('remote', { location: 'Remote - Worldwide', remote: true })).toBe(true);
    expect(placeMatches('remote', { location: 'Remote - USA', remote: true })).toBe(false);
    expect(placeMatches('tel-aviv', { location: 'Remote - EMEA', remote: true })).toBe(true);
    expect(placeMatches('tel-aviv', { location: 'Remote - USA', remote: true })).toBe(false);
  });
});

describe('summarize', () => {
  it('counts relevant jobs and empty searches', () => {
    const good = judgeJob(qaTelAviv, job(), now);
    const bad = judgeJob(qaTelAviv, job({ title: 'Chef' }), now);
    const result = (jobs: (typeof good)[]) => ({ case: qaTelAviv, jobs, precision: null, failedSources: [], ms: 1 });
    expect(summarize([result([good, bad]), result([])])).toEqual({ cases: 2, jobs: 2, relevant: 1, precision: 0.5, empty: 1 });
  });
});
