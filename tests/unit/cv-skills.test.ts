import { describe, expect, it } from 'vitest';
import { scanSkills, type ScanAlias } from '@/server/matching/cv-skills';
import { SAMPLE_CV_LINES } from '../support/make-pdf';

const aliases: ScanAlias[] = [
  { alias: 'javascript', skillId: 'js' },
  { alias: 'js', skillId: 'js' },
  { alias: 'java', skillId: 'java' },
  { alias: 'typescript', skillId: 'ts' },
  { alias: 'react', skillId: 'react' },
  { alias: 'react native', skillId: 'rn' },
  { alias: 'node.js', skillId: 'node' },
  { alias: 'nodejs', skillId: 'node' },
  { alias: 'c++', skillId: 'cpp' },
  { alias: 'c#', skillId: 'csharp' },
  { alias: '.net', skillId: 'dotnet' },
  { alias: 'asp.net', skillId: 'aspnet' },
  { alias: 'postgresql', skillId: 'pg' },
  { alias: 'docker', skillId: 'docker' },
  { alias: 'machine learning', skillId: 'ml' },
];

const scan = (text: string) => Object.fromEntries(scanSkills(text, aliases));

describe('scanSkills', () => {
  it('finds the skills in a CV, case-insensitively', () => {
    expect(scan(SAMPLE_CV_LINES.join('\n'))).toEqual({ ts: 1, react: 1, node: 1, pg: 1, docker: 1 });
  });

  it('matches whole tokens only', () => {
    expect(scan('JavaScript developer')).toEqual({ js: 1 });
    expect(scan('Javanese cuisine, reactive systems')).toEqual({});
  });

  it('handles aliases with symbols', () => {
    expect(scan('C++, C# and ASP.NET; also .NET Core')).toEqual({ cpp: 1, csharp: 1, aspnet: 1, dotnet: 1 });
    expect(scan('Node.js. NodeJS!')).toEqual({ node: 2 });
  });

  it('lets the longest alias win, so a span is never counted twice', () => {
    expect(scan('React Native apps')).toEqual({ rn: 1 });
    expect(scan('React Native and React')).toEqual({ rn: 1, react: 1 });
  });

  it('counts repeated mentions and tolerates line breaks inside multi-word skills', () => {
    expect(scan('Docker, docker compose, DOCKER')).toEqual({ docker: 3 });
    expect(scan('machine\nlearning')).toEqual({ ml: 1 });
  });

  it('works next to Hebrew text and punctuation', () => {
    expect(scan('ניסיון ב-React ו-TypeScript (3 שנים)')).toEqual({ react: 1, ts: 1 });
  });
});
