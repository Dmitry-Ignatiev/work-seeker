import { generateText, Output } from 'ai';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiBudgetExceededError } from '@/server/ai/errors';
import { MOCK_USAGE, resetMockResponders, setMockResponder } from '@/server/ai/mock';
import { runAi } from '@/server/ai/run';
import { db } from '@/server/db';
import { createTestUser, resetDatabase } from '../support/db';

const schema = z.object({ answer: z.string() });

function askAnswer(userId: string | null) {
  return runAi({
    userId,
    kind: 'EXTRACT_REQUIREMENTS',
    promptVersion: 'test-v1',
    input: { question: 'q' },
    call: async model => {
      const result = await generateText({ model, output: Output.object({ schema }), prompt: 'Answer.' });
      return { value: result.output, usage: result.totalUsage };
    },
  });
}

describe('runAi', () => {
  beforeEach(async () => {
    await resetDatabase();
    resetMockResponders();
    delete process.env.AI_DAILY_TOKEN_LIMIT;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('returns schema-validated output and records a ledger row without the prompt', async () => {
    const user = await createTestUser();
    setMockResponder('EXTRACT_REQUIREMENTS', () => ({ answer: '42' }));

    await expect(askAnswer(user.id)).resolves.toEqual({ answer: '42' });

    const runs = await db.aiRun.findMany();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      userId: user.id,
      kind: 'EXTRACT_REQUIREMENTS',
      promptVersion: 'test-v1',
      succeeded: true,
      inputTokens: MOCK_USAGE.input,
      outputTokens: MOCK_USAGE.output,
    });
    expect(runs[0].inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('records failures and rethrows', async () => {
    setMockResponder('EXTRACT_REQUIREMENTS', () => 'not json');

    await expect(askAnswer(null)).rejects.toThrow();

    const [run] = await db.aiRun.findMany();
    expect(run).toMatchObject({ succeeded: false, userId: null });
    expect(run.error).toBeTruthy();
  });

  it('refuses once the daily budget is used up, without calling the model', async () => {
    const user = await createTestUser();
    process.env.AI_DAILY_TOKEN_LIMIT = '150';
    let calls = 0;
    setMockResponder('EXTRACT_REQUIREMENTS', () => {
      calls++;
      return { answer: 'ok' };
    });

    await askAnswer(user.id); // spends 150 tokens
    await expect(askAnswer(user.id)).rejects.toBeInstanceOf(AiBudgetExceededError);
    expect(calls).toBe(1);
  });

  it('keeps budgets separate per user', async () => {
    const [a, b] = [await createTestUser(), await createTestUser()];
    process.env.AI_DAILY_TOKEN_LIMIT = '150';
    setMockResponder('EXTRACT_REQUIREMENTS', () => ({ answer: 'ok' }));

    await askAnswer(a.id);
    await expect(askAnswer(b.id)).resolves.toEqual({ answer: 'ok' });
  });
});
