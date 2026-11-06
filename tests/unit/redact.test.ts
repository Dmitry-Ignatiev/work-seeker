import { describe, expect, it } from 'vitest';
import { redactPii } from '@/server/ai/redact';

const CV = `Dana Levi
dana.levi@example.com | +972 50-123-4567 | (555) 123-4567
linkedin.com/in/dana-levi · https://github.com/danalevi.
Senior Engineer at Acme, 2019 - 2023. Led a team of 6.
Dana built the billing platform. Contact: www.danalevi.dev`;

describe('redactPii', () => {
  const result = redactPii(CV, { names: ['Dana Levi'] });

  it('removes emails, phones, urls and names', () => {
    expect(result.text).not.toMatch(/dana|levi|@|example\.com|123-4567|github\.com|linkedin\.com|danalevi/i);
    expect(result.text).toContain('[CANDIDATE]');
    expect(result.text).toContain('[EMAIL]');
    expect(result.text).toContain('[PHONE]');
    expect(result.text).toContain('[URL]');
  });

  it('keeps the professional content, dates and numbers', () => {
    expect(result.text).toContain('Senior Engineer at Acme, 2019 - 2023. Led a team of 6.');
    expect(result.text).toContain('built the billing platform');
  });

  it('returns what it removed, for deterministic contact fields', () => {
    expect(result.emails).toEqual(['dana.levi@example.com']);
    expect(result.phones).toEqual(['+972 50-123-4567', '(555) 123-4567']);
    expect(result.urls).toEqual(['linkedin.com/in/dana-levi', 'https://github.com/danalevi', 'www.danalevi.dev']);
  });

  it('does not treat a year range as a phone number', () => {
    expect(redactPii('Worked 2015-2016 and 2018 – 2021').phones).toEqual([]);
  });

  it('matches names only as whole words', () => {
    expect(redactPii('Danaher and Dana', { names: ['Dana'] }).text).toBe('Danaher and [CANDIDATE]');
  });
});
