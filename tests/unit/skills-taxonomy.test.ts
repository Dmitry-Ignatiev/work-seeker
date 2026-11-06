import { describe, expect, it } from 'vitest';
import taxonomy from '@/prisma/seed-data/skills.json';
import { buildAliasIndex, normalizeSkillName, parseSkillTaxonomy } from '@/server/matching/skills';

describe('normalizeSkillName', () => {
  it('lowercases, collapses spaces and drops trailing punctuation', () => {
    expect(normalizeSkillName('  Node.JS. ')).toBe('node.js');
    expect(normalizeSkillName('Spring   Boot,')).toBe('spring boot');
  });

  it('keeps meaningful symbols', () => {
    expect(normalizeSkillName('C#')).toBe('c#');
    expect(normalizeSkillName('C++')).toBe('c++');
    expect(normalizeSkillName('.NET')).toBe('.net');
  });
});

describe('seed taxonomy (prisma/seed-data/skills.json)', () => {
  const skills = parseSkillTaxonomy(taxonomy);
  const index = buildAliasIndex(skills);
  const textScan = (alias: string) =>
    skills.flatMap(s => s.aliases).find(a => a.alias === alias)?.textScan;

  it('parses without alias collisions and has a useful size', () => {
    expect(skills.length).toBeGreaterThan(300);
  });

  it('resolves common aliases to canonical skills', () => {
    expect(index.get('k8s')).toBe('Kubernetes');
    expect(index.get('golang')).toBe('Go');
    expect(index.get('nodejs')).toBe('Node.js');
    expect(index.get('postgres')).toBe('PostgreSQL');
    expect(index.get('c#')).toBe('C#');
    expect(index.get('typescript')).toBe('TypeScript');
  });

  it('keeps everyday words out of free-text scanning', () => {
    expect(textScan('go')).toBe(false);
    expect(textScan('c')).toBe(false);
    expect(textScan('express')).toBe(false);
    expect(textScan('excel')).toBe(false);
    expect(textScan('golang')).toBe(true);
    expect(textScan('kubernetes')).toBe(true);
  });

  it('rejects an alias claimed by two skills', () => {
    expect(() => parseSkillTaxonomy({ A: [['Alpha', 'x']], B: [['Beta', 'x']] })).toThrow(/maps to both/);
  });
});
