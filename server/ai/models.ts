import 'server-only';
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { AiRunKind } from '@/generated/prisma/enums';
import { AiConfigError } from './errors';

/**
 * The only place that chooses models. Cheap tier for reading untrusted text into structure,
 * stronger tier for judgments. Override with env vars to trade quality for credits.
 */
export const MODEL_IDS = {
  extraction: process.env.AI_EXTRACTION_MODEL || 'claude-haiku-5-5',
  reasoning: process.env.AI_REASONING_MODEL || 'claude-sonnet-5-5',
} as const;

const TIER: Record<AiRunKind, keyof typeof MODEL_IDS> = {
  EXTRACT_REQUIREMENTS: 'extraction',
  PARSE_CV: 'extraction',
  ASSESS_MATCH: 'reasoning',
  CV_SUGGEST: 'reasoning',
  ASSISTANT: 'reasoning',
  TAILOR_CV: 'reasoning',
};

export function isMockMode(): boolean {
  return process.env.AI_MOCK === '1';
}

export async function modelFor(kind: AiRunKind): Promise<{ model: LanguageModel; modelId: string }> {
  const modelId = MODEL_IDS[TIER[kind]];
  if (isMockMode()) {
    // Loaded lazily so test helpers never ship in the real code path.
    const { createMockModel } = await import('./mock');
    return { model: createMockModel(kind), modelId: `mock:${modelId}` };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiConfigError('ANTHROPIC_API_KEY is not set. Add it to .env.local, or set AI_MOCK=1 for offline mode.');
  }
  return { model: anthropic(modelId), modelId };
}
