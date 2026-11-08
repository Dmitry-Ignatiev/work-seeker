import { createAgentUIStreamResponse } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createAssistant } from '@/server/ai/assistant/agent';
import type { JobFocus } from '@/server/ai/assistant/prompt';
import { assertWithinBudget } from '@/server/ai/budget';
import { AiBudgetExceededError, AiConfigError } from '@/server/ai/errors';
import { db } from '@/server/db';
import { NotFoundError } from '@/server/errors';
import { getJobSummary } from '@/server/services/jobs';
import { getCurrentUser } from '@/server/session';

/** A chat is short: past this, start a new one (keeps cost and context bounded). */
const MAX_MESSAGES = 40;
const MAX_REQUESTS_PER_MINUTE = 10;

const bodySchema = z.object({
  messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
  /** Sent by a job page: the job its chat is about and the CV the user picked. */
  context: z.object({ jobId: z.string().min(1).max(100), cvId: z.string().min(1).max(100).optional() }).optional(),
});

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** The job page's focus, only for a job and CV this user can see (anything else looks like a missing job). */
async function focusFor(userId: string, context: { jobId: string; cvId?: string }): Promise<JobFocus> {
  const job = await getJobSummary(userId, context.jobId);
  const cv = context.cvId
    ? await db.cv.findFirst({ where: { id: context.cvId, userId }, select: { id: true, label: true } })
    : await db.cv.findFirst({ where: { userId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }], select: { id: true, label: true } });
  return { job: { id: job.id, title: job.title, company: job.company, location: job.location }, cv: cv ?? undefined };
}

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
    const focus = parsed.data.context ? await focusFor(user.id, parsed.data.context) : undefined;
    const agent = await createAssistant(user.id, {}, focus);
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
    if (error instanceof NotFoundError) return fail('That job is no longer available.', 404);
    if (error instanceof AiBudgetExceededError) return fail(error.message, 429);
    if (error instanceof AiConfigError) return fail('The assistant is not configured yet (missing AI key).', 503);
    throw error;
  }
}
