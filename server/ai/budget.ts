import 'server-only';
import { db } from '@/server/db';
import { dailyTokenLimit, isOverBudget, startOfUtcDay } from './budget-policy';
import { AiBudgetExceededError } from './errors';

/** Input + output tokens this user spent since 00:00 UTC. */
export async function tokensUsedToday(userId: string, now = new Date()): Promise<number> {
  const { _sum } = await db.aiRun.aggregate({
    where: { userId, createdAt: { gte: startOfUtcDay(now) } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (_sum.inputTokens ?? 0) + (_sum.outputTokens ?? 0);
}

export async function assertWithinBudget(userId: string, now = new Date()): Promise<void> {
  const limit = dailyTokenLimit();
  const used = await tokensUsedToday(userId, now);
  if (isOverBudget(used, limit)) throw new AiBudgetExceededError(used, limit);
}
