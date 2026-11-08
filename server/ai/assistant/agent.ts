import 'server-only';
import { createHmac } from 'node:crypto';
import { isStepCount, ToolLoopAgent, type InferAgentUIMessage, type LanguageModel, type LanguageModelUsage } from 'ai';
import { db } from '@/server/db';
import { hashInput } from '../run';
import { modelFor } from '../models';
import { ASSISTANT_INSTRUCTIONS, ASSISTANT_PROMPT_VERSION, jobFocusInstructions, type JobFocus } from './prompt';
import { createAssistantTools, type AssistantToolDeps } from './tools';

export const MAX_STEPS = 10;

/** A key for signing tool approvals, derived from the auth secret (no extra env var to manage). */
function approvalSecret(): string {
  const base = process.env.BETTER_AUTH_SECRET || 'local-development-only';
  return createHmac('sha256', base).update('work-seeker:tool-approval').digest('base64url');
}

function buildAgent(
  model: LanguageModel,
  userId: string,
  deps: AssistantToolDeps,
  focus: JobFocus | undefined,
  onUsage?: (usage: LanguageModelUsage) => Promise<void>,
) {
  const tools = createAssistantTools(deps);
  return new ToolLoopAgent({
    model,
    instructions: [
      // Same instructions on every call: cached by Anthropic (about 10% of the price from the second call).
      { role: 'system', content: ASSISTANT_INSTRUCTIONS, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
      // On a job page: which job and CV this chat is about.
      ...(focus ? [{ role: 'system' as const, content: jobFocusInstructions(focus) }] : []),
    ],
    tools,
    toolsContext: {
      searchJobs: { userId },
      addJob: { userId },
      getJob: { userId },
      tailorCv: { userId, cvId: focus?.cv?.id },
      confirmExperience: { userId },
      followCompany: { userId },
    },
    // Recording experience the CV doesn't show needs the user's click.
    toolApproval: { confirmExperience: 'user-approval' },
    // Approvals come back from the browser: sign them so a forged "approved" is rejected.
    experimental_toolApprovalSecret: approvalSecret(),
    stopWhen: isStepCount(MAX_STEPS),
    // The model thinks before answering and that counts as output: room for both.
    maxOutputTokens: 4_000,
    providerOptions: {
      anthropic: {
        effort: 'medium',
        // The chat history comes back from the browser rebuilt from UI messages, which can differ slightly from
        // what the model saw. Drop thinking blocks that no longer match instead of failing the whole reply.
        // The API requires the thinking type with it; adaptive is the models' default anyway.
        thinking: { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'drop_block' } },
      },
    },
    onEnd: onUsage ? ({ usage }) => onUsage(usage) : undefined,
  });
}

export type AssistantAgent = ReturnType<typeof buildAgent>;
export type AssistantMessage = InferAgentUIMessage<AssistantAgent>;

/**
 * A fresh agent per request, bound to the signed-in user (and, on a job page, to that job and the CV they
 * picked; the caller has checked both belong to the user). Token usage of the whole run is written to the
 * AiRun ledger when it ends; prompts and replies are never stored.
 */
export async function createAssistant(userId: string, deps: AssistantToolDeps = {}, focus?: JobFocus): Promise<AssistantAgent> {
  const { model, modelId } = await modelFor('ASSISTANT');
  const started = Date.now();
  return buildAgent(model, userId, deps, focus, async usage => {
    await db.aiRun.create({
      data: {
        userId,
        kind: 'ASSISTANT',
        model: modelId,
        promptVersion: ASSISTANT_PROMPT_VERSION,
        inputHash: hashInput({ userId, started }),
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
        succeeded: true,
        durationMs: Date.now() - started,
      },
    });
  });
}
