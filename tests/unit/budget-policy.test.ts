import { describe, expect, it } from 'vitest';
import { DEFAULT_DAILY_TOKEN_LIMIT, dailyTokenLimit, isOverBudget, startOfUtcDay } from '@/server/ai/budget-policy';

describe('budget policy', () => {
  it('uses the env limit when valid, otherwise the default', () => {
    expect(dailyTokenLimit('50000')).toBe(50_000);
    expect(dailyTokenLimit(undefined)).toBe(DEFAULT_DAILY_TOKEN_LIMIT);
    expect(dailyTokenLimit('abc')).toBe(DEFAULT_DAILY_TOKEN_LIMIT);
    expect(dailyTokenLimit('-5')).toBe(DEFAULT_DAILY_TOKEN_LIMIT);
  });

  it('starts the day at 00:00 UTC', () => {
    expect(startOfUtcDay(new Date('2026-11-04T23:59:00+02:00')).toISOString()).toBe('2026-11-04T00:00:00.000Z');
  });

  it('refuses once usage reaches the limit', () => {
    expect(isOverBudget(299_999, 300_000)).toBe(false);
    expect(isOverBudget(300_000, 300_000)).toBe(true);
  });
});
