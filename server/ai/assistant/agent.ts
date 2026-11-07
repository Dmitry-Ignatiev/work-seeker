import 'server-only';
import { isStepCount, ToolLoopAgent, type InferAgentUIMessage, type LanguageModel, type LanguageModelUsage } from 'ai';
import { db } from '@/server/db';
import { hashInput } from '../run';
import { modelFor } from '../models';
import { ASSISTANT_INSTRUCTIONS, ASSISTANT_PROMPT_VERSION } from './prompt';
import { createAssistantTools, type AssistantToolDeps } from './tools';

export const MAX_STEPS = 10;

function buildAgent(model: LanguageModel, userId: string, deps: AssistantToolDeps, onUsage?: (usage: LanguageModelUsage) => Promise<void>) {
  const tools = createAssistantTools(deps);
  return new ToolLoopAgent({
    model,
    // Same instructions on every call: cached by Anthropic (about 10% of the price from the second call).
    instructions: {
      role: 'system',
      content: ASSISTANT_INSTRUCTIONS,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    tools,
    toolsContext: {
      searchJobs: { userId },
      addJob: { userId },
      getJob: { userId },
      followCompany: { userId },
    },
    stopWhen: isStepCount(MAX_STEPS),
    maxOutputTokens: 1_500,
    onEnd: onUsage ? ({ usage }) => onUsage(usage) : undefined,
  });
}

export type AssistantAgent = ReturnType<typeof buildAgent>;
export type AssistantMessage = InferAgentUIMessage<AssistantAgent>;

/**
 * A fresh agent per request, bound to the signed-in user. Token usage of the whole run
 * (all steps) is written to the AiRun ledger when it ends; prompts and replies are never stored.
 */
export async function createAssistant(userId: string, deps: AssistantToolDeps = {}): Promise<AssistantAgent> {
  const { model, modelId } = await modelFor('ASSISTANT');
  const started = Date.now();
  return buildAgent(model, userId, deps, async usage => {
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
