# Work Seeker

An AI job-search platform: paste a job link, see which requirements you meet (with evidence), get the best CV
for it, and track the application. Built with Next.js 16, the Vercel AI SDK (Anthropic models), Prisma 7 +
PostgreSQL and Better Auth. Everything runs on free services except the Anthropic API.

The full architecture and roadmap are in [docs/architecture-plan.md](docs/architecture-plan.md).
**Status:** Phase 0 (foundation) is done. Product features start in Phase 1.

## Local setup

Requires Node 24. No Docker needed: Prisma ships a free local Postgres.

```bash
npm install
npm run db:dev          # local database
npm run db:dev:test     # separate database for tests
npx prisma dev ls       # shows both servers' URLs
cp .env.example .env.local   # then fill in the URLs, BETTER_AUTH_SECRET and ANTHROPIC_API_KEY
npm run db:migrate
npm run db:seed         # skills taxonomy
npm run dev
```

Open http://localhost:3000. Outside production you can sign up with email and password. Production uses
Google and GitHub sign-in only (see `.env.example`).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm test` | Unit tests (pure code, no database) |
| `npm run test:integration` | Integration tests against `TEST_DATABASE_URL` (it gets truncated) |
| `npm run test:e2e` | Playwright tests against `TEST_DATABASE_URL`, with mocked AI. Stop other `next dev` servers for this folder first |
| `npm run db:migrate` | Create and apply a migration, then regenerate the client |
| `npm run db:seed` | Seed or update the skills taxonomy (idempotent) |

## Project layout

```
app/              routes: (marketing) landing, (auth) sign-in, (app) signed-in pages, api/
components/       UI (components/ui is shadcn)
server/           server-only code
  ai/             model choice, budget, PII redaction, AI call ledger, offline mocks
  discovery/      job-board adapters
  matching/       pure matching logic (skills taxonomy so far)
  auth.ts, session.ts, db.ts
prisma/           schema, migrations, seed + skills taxonomy data
tests/            unit + integration (Vitest)
e2e/              Playwright
```

## AI usage

All model calls go through `server/ai/run.ts`. It checks the user's daily token budget, picks the model
(`claude-haiku-5-5` for extraction, `claude-sonnet-5-5` for judgments), and records token counts in the
`AiRun` table. Prompts and responses are never stored. Set `AI_MOCK=1` to run fully offline.
