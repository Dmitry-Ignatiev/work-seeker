import 'server-only';
import { createHash } from 'node:crypto';
import type { LanguageModel, LanguageModelUsage } from 'ai';
import type { AiRunKind } from '@/generated/prisma/enums';
import { db } from '@/server/db';
import { assertWithinBudget } from './budget';
import { modelFor } from './models';

export function hashInput(input: unknown): string {
  return createHash('sha256').update(typeof input === 'string' ? input : JSON.stringify(input)).digest('hex');
}

export interface RunAiOptions<T> {
  /** null for system work (e.g. extracting a public job posting during a scheduled run). */
  userId: string | null;
  kind: AiRunKind;
  promptVersion: string;
  /** What the call depends on; hashed for the AiRun ledger and cache lookups. Never stored raw. */
  input: unknown;
  call: (model: LanguageModel) => Promise<{ value: T; usage: LanguageModelUsage }>;
}

/**
 * Every model call goes through here: budget check, model choice, and an AiRun ledger row
 * with token counts only (prompts and responses are never logged).
 */
export async function runAi<T>({ userId, kind, promptVersion, input, call }: RunAiOptions<T>): Promise<T> {
  if (userId) await assertWithinBudget(userId);
  const { model, modelId } = await modelFor(kind);
  const inputHash = hashInput(input);
  const started = Date.now();

  try {
    const { value, usage } = await call(model);
    await db.aiRun.create({
      data: {
        userId,
        kind,
        model: modelId,
        promptVersion,
        inputHash,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
        succeeded: true,
        durationMs: Date.now() - started,
      },
    });
    return value;
  } catch (error) {
    await db.aiRun.create({
      data: {
        userId,
        kind,
        model: modelId,
        promptVersion,
        inputHash,
        succeeded: false,
        error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : 'Unknown error',
        durationMs: Date.now() - started,
      },
    });
    throw error;
  }
}
