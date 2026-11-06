@AGENTS.md

# Work Seeker

An AI job-search agent (Next.js 16, Vercel AI SDK 7, Anthropic, Prisma 7 + Postgres, Better Auth).
What it does and the agent's tools: `SPEC.md`. Full architecture and roadmap: `docs/architecture-plan.md`.

## Run

```bash
npm run db:dev && npm run db:dev:test   # local Prisma Postgres (dev + test)
npm run dev                             # http://localhost:3000
```

## Check before every commit

```bash
npm run typecheck && npm run lint && npm test
npm run test:integration                # needs db:dev:test
npm run test:e2e                        # mocked AI; stop other `next dev` for this folder first
```

## Rules

- Use the ai-sdk skill for AI SDK code and read `node_modules/next/dist/docs/` for Next.js APIs. Both differ from older versions.
- **Authorization lives in services** (`server/services/*`). Every function takes `userId` first and scopes every query by it. Another user's id must look exactly like a missing one (`NotFoundError`).
- Server-only modules import `server-only`. Server Actions and route inputs are validated with zod.
- Every model call goes through `runAi` (`server/ai/run.ts`): budget check plus the `AiRun` ledger. Never log prompts, CV text or responses.
- Untrusted text (job pages, CVs) only goes to tool-less structured-output calls. Code validates every quote and id the model returns.
- Numbers (scores) come from code, not from the model.
- CV files are never stored: they're parsed in memory and only the text is kept.
- Tests never call a real model (`AI_MOCK=1`). Integration tests truncate `TEST_DATABASE_URL`.
- Small commits, one change each.
