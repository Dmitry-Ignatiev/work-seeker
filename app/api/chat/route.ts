import { createAgentUIStreamResponse } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAssistant } from '@/server/ai/assistant/agent';
import { assertWithinBudget } from '@/server/ai/budget';
import { AiBudgetExceededError, AiConfigError } from '@/server/ai/errors';
import { db } from '@/server/db';
import { getCurrentUser } from '@/server/session';

/** A chat is short: past this, start a new one (keeps cost and context bounded). */
const MAX_MESSAGES = 40;
const MAX_REQUESTS_PER_MINUTE = 10;

const bodySchema = z.object({ messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES) });

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Assistant chat: the signed-in user's agent, streamed as UI messages (text, tool calls, results). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return fail('Sign in to chat.', 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(`This chat is too long or malformed. Start a new chat (max ${MAX_MESSAGES} messages).`, 400);
  }

  const recent = await db.aiRun.count({
    where: { userId: user.id, kind: 'ASSISTANT', createdAt: { gte: new Date(Date.now() - 60_000) } },
  });
  if (recent >= MAX_REQUESTS_PER_MINUTE) return fail('Too many messages in a minute. Wait a moment and try again.', 429);

  try {
    await assertWithinBudget(user.id);
    const agent = await createAssistant(user.id);
    return createAgentUIStreamResponse({
      agent,
      uiMessages: parsed.data.messages,
      abortSignal: request.signal,
      // Never send internal error details to the browser.
      onError: error => {
        console.error('assistant stream failed:', error instanceof Error ? error.name : 'unknown');
        return 'Something went wrong while answering. Please try again.';
      },
    });
  } catch (error) {
    if (error instanceof AiBudgetExceededError) return fail(error.message, 429);
    if (error instanceof AiConfigError) return fail('The assistant is not configured yet (missing AI key).', 503);
    throw error;
  }
}
