import { isStepCount, ToolLoopAgent } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createAssistant } from '@/server/ai/assistant/agent';
import { createAssistantTools } from '@/server/ai/assistant/tools';
import { db } from '@/server/db';
import { fixtureJobs } from '@/server/discovery/sources/fixture';
import { addJobFromText } from '@/server/services/jobs';
import { createTestUser, resetDatabase } from '../support/db';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that calls one tool, then answers. */
function scripted(toolName: string, input: unknown) {
  return new MockLanguageModelV4({
    doGenerate: [
      {
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName, input: JSON.stringify(input) }],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage,
        warnings: [],
      },
      { content: [{ type: 'text', text: 'done' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] },
    ],
  });
}

function agentFor(userId: string, model: MockLanguageModelV4) {
  return new ToolLoopAgent({
    model,
    tools: createAssistantTools({ search: { sources: [fixtureJobs] } }),
    toolsContext: {
      searchJobs: { userId },
      addJob: { userId },
      getJob: { userId },
      tailorCv: { userId },
      confirmExperience: { userId },
      followCompany: { userId },
    },
    stopWhen: isStepCount(5),
  });
}

const toolResult = (result: Awaited<ReturnType<ReturnType<typeof agentFor>['generate']>>) =>
  result.steps.flatMap(step => step.toolResults).map(r => r.output)[0];

describe('assistant', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("can't read another user's pasted job, even when the model asks for its id", async () => {
    const alice = await createTestUser();
    const bob = await createTestUser();
    const added = await addJobFromText(alice.id, { text: 'Private posting for a backend role. '.repeat(10), title: 'Backend' });
    if (added.status !== 'OK') throw new Error(added.status);

    const asBob = await agentFor(bob.id, scripted('getJob', { jobId: added.job.id })).generate({ prompt: 'details' });
    expect(toolResult(asBob)).toEqual({ found: false });

    const asAlice = await agentFor(alice.id, scripted('getJob', { jobId: added.job.id })).generate({ prompt: 'details' });
    expect(toolResult(asAlice)).toMatchObject({ found: true, title: 'Backend' });
  });

  it('gives the model untrusted job text inside delimiters', async () => {
    const user = await createTestUser();
    const model = scripted('searchJobs', { query: 'backend engineer' });
    await agentFor(user.id, model).generate({ prompt: 'backend jobs' });

    const secondCall = JSON.stringify(model.doGenerateCalls[1].prompt);
    expect(secondCall).toContain('<untrusted_job_content>');
    expect(secondCall).toContain('Senior Backend Engineer (Node.js)');
    expect(secondCall).toContain('Sources: Demo listings ok');
  });

  it('runs end to end with the offline model and records token usage, never the prompt', async () => {
    const user = await createTestUser();
    const agent = await createAssistant(user.id, { search: { sources: [fixtureJobs] } });

    const result = await agent.generate({ prompt: 'Senior backend jobs in Tel Aviv' });

    expect(result.text).toContain('Here are the jobs I found');
    // 2 of the 3 demo listings are backend roles; "Platform Engineer" is not, so it isn't saved.
    expect(await db.job.count()).toBe(2);
    const [run] = await db.aiRun.findMany();
    expect(run).toMatchObject({ userId: user.id, kind: 'ASSISTANT', promptVersion: 'assistant-v4', succeeded: true });
    expect(run.inputTokens).toBeGreaterThan(0);
    expect(JSON.stringify(run)).not.toContain('Tel Aviv');
  });
});
