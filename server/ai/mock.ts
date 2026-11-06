import 'server-only';
import { MockLanguageModelV4 } from 'ai/test';
import type { AiRunKind } from '@/generated/prisma/enums';

/**
 * Offline models for tests and E2E (AI_MOCK=1). Each AI kind gets a responder that
 * returns the model's raw output: an object (sent as JSON text) or a string.
 * Later phases register default fixtures; tests can override them per case.
 */
export type MockResponder = (callOptions: unknown) => unknown;

const responders = new Map<AiRunKind, MockResponder>();

export function setMockResponder(kind: AiRunKind, responder: MockResponder): void {
  responders.set(kind, responder);
}

export function resetMockResponders(): void {
  responders.clear();
}

export const MOCK_USAGE = { input: 100, output: 50 } as const;

export function createMockModel(kind: AiRunKind): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: `mock-${kind.toLowerCase()}`,
    doGenerate: async callOptions => {
      const responder = responders.get(kind);
      if (!responder) throw new Error(`No mock responder registered for ${kind}`);
      const out = await responder(callOptions);
      return {
        content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: MOCK_USAGE.input, noCache: MOCK_USAGE.input, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: MOCK_USAGE.output, text: MOCK_USAGE.output, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
