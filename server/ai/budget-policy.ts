/** Pure budget rules (no database), shared by server/ai/budget.ts and tests. */
export const DEFAULT_DAILY_TOKEN_LIMIT = 300_000;

export function dailyTokenLimit(env: string | undefined = process.env.AI_DAILY_TOKEN_LIMIT): number {
  const parsed = Number(env);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_DAILY_TOKEN_LIMIT;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isOverBudget(used: number, limit: number): boolean {
  return used >= limit;
}
