import 'server-only';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { simulateReadableStream } from 'ai';
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
  if (kind === 'ASSISTANT' && !responders.has(kind)) return createScriptedAssistant();
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: `mock-${kind.toLowerCase()}`,
    doGenerate: async callOptions => {
      const responder = responders.get(kind) ?? DEFAULT_RESPONDERS[kind];
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

// ───────────────────────── Scripted assistant (offline chat for E2E and local demos) ─────────────────────────

const STREAM_USAGE = {
  inputTokens: { total: MOCK_USAGE.input, noCache: MOCK_USAGE.input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: MOCK_USAGE.output, text: MOCK_USAGE.output, reasoning: undefined },
};

type PromptMessage = { role: string; content: unknown };

function lastMessage(callOptions: unknown): PromptMessage | undefined {
  const prompt = (callOptions as { prompt?: PromptMessage[] }).prompt ?? [];
  return prompt.at(-1);
}

function textOf(message: PromptMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  return (message.content as { type: string; text?: string }[])
    .filter(part => part.type === 'text')
    .map(part => part.text ?? '')
    .join(' ');
}

/** Decides the next step like a (very) simple agent: search for job requests, then summarise. */
function nextStep(callOptions: unknown): { toolName: string; input: unknown } | { text: string } {
  const last = lastMessage(callOptions);
  if (last?.role === 'tool') {
    const result = JSON.stringify(last.content);
    if (result.includes('NEEDS_CV')) return { text: 'Upload your CV in the box above and I’ll tailor it right after.' };
    if (result.includes('Tailored CV saved')) {
      return { text: 'Your tailored CV is ready. I only used keywords your CV already backs; the rest are listed as missing.' };
    }
    if (result.includes('keywordKey') || result.includes('"detail"')) return { text: 'Saved. Ask me to tailor your CV again to use it.' };
    if (result.includes('NEEDS_PASTE')) return { text: 'I can\u2019t read that site automatically. Please paste the job description here.' };
    if (result.includes('No matching jobs')) return { text: 'I didn\u2019t find matching jobs. Try a broader search.' };
    if (result.includes('untrusted_job_content') && !result.includes('jobId')) {
      return { text: 'This role asks for solid backend experience. Want me to find similar jobs?' };
    }
    return { text: 'Here are the jobs I found. Open one to see the full posting, or ask me to narrow the search.' };
  }
  const text = textOf(last).trim();
  const jobId = text.match(/jobId\s+([\w-]+)/)?.[1];
  if (jobId && /tailor|uploaded my CV/i.test(text)) return { toolName: 'tailorCv', input: { jobId } };
  if (jobId) return { toolName: 'getJob', input: { jobId } };
  const confirmed = text.match(/I (?:do )?have (?:real )?experience with ([^:]+):\s*(.+)/i);
  if (confirmed) return { toolName: 'confirmExperience', input: { keyword: confirmed[1].trim(), detail: confirmed[2].trim() } };
  const url = text.match(/https?:\/\/\S+/)?.[0];
  if (url) return { toolName: 'addJob', input: { url } };
  if (/weather|joke|recipe/i.test(text)) return { text: 'I can only help with job search and CVs.' };
  return { toolName: 'searchJobs', input: { query: text.slice(0, 120) || 'software engineer' } };
}

function createScriptedAssistant(): MockLanguageModelV4 {
  let calls = 0;
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-assistant',
    doGenerate: async callOptions => {
      const step = nextStep(callOptions);
      return 'text' in step
        ? {
            content: [{ type: 'text', text: step.text }],
            finishReason: { unified: 'stop', raw: undefined },
            usage: STREAM_USAGE,
            warnings: [],
          }
        : {
            content: [{ type: 'tool-call', toolCallId: `call-${++calls}`, toolName: step.toolName, input: JSON.stringify(step.input) }],
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: STREAM_USAGE,
            warnings: [],
          };
    },
    doStream: async callOptions => {
      const step = nextStep(callOptions);
      const chunks: LanguageModelV4StreamPart[] =
        'text' in step
          ? [
              { type: 'text-start', id: 't1' },
              ...step.text.split(/(?<= )/).map((delta): LanguageModelV4StreamPart => ({ type: 'text-delta', id: 't1', delta })),
              { type: 'text-end', id: 't1' },
              { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: STREAM_USAGE },
            ]
          : [
              { type: 'tool-call', toolCallId: `call-${++calls}`, toolName: step.toolName, input: JSON.stringify(step.input) },
              { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: STREAM_USAGE },
            ];
      return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 5 }) };
    },
  });
}

// ───────────────────────── Default responders for the tailoring calls (offline, deterministic) ─────────────────────────

/** The user message the model was sent (the system prompt also mentions the tags, so it's skipped). */
function promptText(callOptions: unknown): string {
  return textOf(lastMessage(callOptions));
}

const between = (text: string, open: string, close: string) => {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  return start >= 0 && end > start ? text.slice(start + open.length, end).trim() : '';
};

const MOCK_TECH = ['Node.js', 'TypeScript', 'AWS', 'PostgreSQL', 'Docker', 'Kubernetes', 'React', 'gRPC', 'Terraform', 'Python', 'Go'];

/** Keywords: known technologies the posting names, each quoted with its sentence. */
function mockKeywords(callOptions: unknown) {
  const posting = between(promptText(callOptions), '<job_posting>', '</job_posting>');
  // Split on sentence ends followed by whitespace: "Node.js" has a dot but no space after it.
  const sentences = posting.split(/(?<=[.!?])\s+|\n/);
  const keywords = MOCK_TECH.flatMap(keyword => {
    const pattern = new RegExp(`(?<![\\w.])${keyword.replace(/[.+]/g, '\\$&')}(?![\\w])`);
    const sentence = sentences.find(s => pattern.test(s));
    return sentence ? [{ keyword, kind: 'TECH', importance: 'MUST', quote: sentence.trim() }] : [];
  });
  return { keywords };
}

/** CV structure: one experience entry; sentence-like lines are its bullets. */
function mockCvStructure(callOptions: unknown) {
  const lines = between(promptText(callOptions), '<cv>', '</cv>')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const role = lines.find(l => /,.*\d{4}/.test(l));
  return {
    headline: undefined,
    sections: [
      {
        kind: 'EXPERIENCE',
        heading: lines.find(l => /^experience$/i.test(l)) ?? 'Experience',
        entries: [{ title: role, bullets: lines.filter(l => l.length > 40 && /\.$/.test(l)) }],
      },
    ],
    skills: [],
  };
}

/**
 * Tailoring: one truthful edit (mentions Node.js, which the CV has elsewhere) and one the guard must
 * refuse (claims AWS, which the CV never mentions).
 */
function mockTailoring(callOptions: unknown) {
  const payload = JSON.parse(between(promptText(callOptions), '<untrusted>', '</untrusted>') || '{}') as {
    cv?: { bullets?: { id: string; text: string }[] };
  };
  const edits = (payload.cv?.bullets ?? []).flatMap(b => {
    if (b.text.includes('dashboards')) return [{ bulletId: b.id, text: b.text.replace('dashboards', 'dashboards with a Node.js backend'), evidence: [] }];
    if (b.text.includes('Node.js APIs')) return [{ bulletId: b.id, text: b.text.replace(/\.$/, ' on AWS.'), evidence: [] }];
    return [];
  });
  return { summary: null, edits };
}

const DEFAULT_RESPONDERS: Partial<Record<AiRunKind, MockResponder>> = {
  EXTRACT_REQUIREMENTS: mockKeywords,
  PARSE_CV: mockCvStructure,
  TAILOR_CV: mockTailoring,
};
