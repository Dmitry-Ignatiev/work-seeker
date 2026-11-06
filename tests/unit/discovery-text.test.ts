import { describe, expect, it } from 'vitest';
import { fixMojibake, formatSalary, htmlToText, keywords, keywordScore } from '@/server/discovery/text';

describe('htmlToText', () => {
  it('strips tags and keeps paragraph breaks', () => {
    expect(htmlToText('<p>Hello <b>world</b></p><p>Second</p>')).toBe('Hello world\nSecond');
  });

  it('decodes entity-encoded HTML before stripping', () => {
    expect(htmlToText('&lt;p&gt;Rust &amp;amp; Go&lt;/p&gt;')).toBe('Rust & Go');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText(null)).toBe('');
  });
});

describe('fixMojibake', () => {
  it('repairs UTF-8 read as Latin-1', () => {
    expect(fixMojibake('MÃ¼nchen')).toBe('München');
  });

  it('leaves clean text alone', () => {
    expect(fixMojibake('München')).toBe('München');
    expect(fixMojibake('Berlin')).toBe('Berlin');
  });
});

describe('formatSalary', () => {
  it('formats ranges and single values', () => {
    expect(formatSalary(80000, 120000)).toBe('$80k–$120k');
    expect(formatSalary(50000, 50000, '€')).toBe('€50k');
    expect(formatSalary(undefined, 900)).toBe('$900');
    expect(formatSalary(null, null)).toBeUndefined();
  });
});

describe('keywords + keywordScore', () => {
  it('drops stop words and keeps tech tokens', () => {
    expect(keywords('Senior C# and Node.js jobs in Berlin')).toEqual(['senior', 'c#', 'node.js', 'berlin']);
  });

  it('weights title over tags over description', () => {
    const job = { title: 'React Developer', tags: ['typescript'], description: 'We use GraphQL' };
    expect(keywordScore(job, ['react'])).toBe(3);
    expect(keywordScore(job, ['typescript'])).toBe(2);
    expect(keywordScore(job, ['graphql'])).toBe(1);
    expect(keywordScore(job, ['rust'])).toBe(0);
  });
});
