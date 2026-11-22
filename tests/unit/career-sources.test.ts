import { describe, expect, it } from 'vitest';
import careerSources from '@/prisma/seed-data/career-sources.json';
import { SLUG_PATTERN } from '@/server/discovery/ats/boards';

describe('career-sources.json', () => {
  const boards = careerSources.boards;

  it('names a supported system, a valid slug and a company for every board', () => {
    for (const board of boards) {
      expect(['greenhouse', 'lever', 'ashby']).toContain(board.ats);
      expect(board.slug).toMatch(SLUG_PATTERN);
      expect(board.companyName.trim()).not.toBe('');
    }
  });

  it('lists each board once', () => {
    const keys = boards.map(b => `${b.ats}:${b.slug.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
