# Work Seeker

A chat that finds high-tech jobs in Israel and remote, then tailors your CV to the job you pick: it works the
job's keywords in only where your real experience supports them. Built with Next.js 16, the Vercel AI SDK
(Anthropic Claude), Prisma 7 + PostgreSQL and Better Auth.

**Live:** https://work-seeker-sigma.vercel.app · What the agent does and its tools: [SPEC.md](SPEC.md) ·
Architecture: [docs/architecture-plan.md](docs/architecture-plan.md)

## Local setup

Requires Node 24. No Docker needed: Prisma ships a free local Postgres.

```bash
npm install
npm run db:dev          # local database
npm run db:dev:test     # separate database for tests
npx prisma dev ls       # shows both servers' URLs
cp .env.example .env.local   # then fill in the URLs, BETTER_AUTH_SECRET and ANTHROPIC_API_KEY
npm run db:migrate
npm run db:seed         # skills taxonomy and company job boards
npm run dev
```

Open http://localhost:3000 and sign up with email and password. Google and GitHub sign-in are optional
(see `.env.example`). `npm run dev:offline` runs with no outside calls at all (scripted model, demo listings).

## Accounts and password recovery

The app sends no email. A forgotten password is reset with a **recovery code** instead, following the
OWASP Forgot Password Cheat Sheet ("offline method").

**For users**

- Right after sign-up the app offers a recovery code such as `K7QF-2M9X-PL4R-8WZN`. Save it in a password
  manager. It is shown once.
- Signed in, **Recovery code** in the top bar creates one, or replaces it if it was lost or seen by someone else.
  Accounts created before recovery codes existed have none until they do this.
- **Forgot password?** on the sign-in page asks for email, recovery code and a new password. On success the
  old code stops working, a new one is shown, and every device is signed out.

**For the site owner: a user lost both password and code**

Create a one-time reset link (valid 1 hour) and send it to them yourself. Check who is asking first:
whoever opens the link can set the password.

Local database (uses `.env.local`):

```bash
npm run reset-link -- someone@example.com
```

Live site: pull the production settings, create the link, then delete the file (it holds the live database
password). Vercel never reveals values marked *Sensitive* (they come back as `[SENSITIVE]`), so the site
address is passed with `--url`.

```bash
vercel env pull .env.production.local --environment=production
npm run reset-link -- someone@example.com --env .env.production.local --url https://work-seeker-sigma.vercel.app
```

Then delete `.env.production.local` (`rm` in bash, `Remove-Item` in PowerShell).

**How it is protected**

- Nothing about the account changes until the code is proven, so typing someone's email locks no one out.
- The answer is the same for an unknown email, a wrong code or a locked code, so nobody can probe which
  emails have accounts.
- 5 wrong tries lock a code for 15 minutes; there is also a per-IP limit (per server instance).
- Codes have 80 bits from a secure random generator. Only an HMAC keyed from `BETTER_AUTH_SECRET` is stored,
  so a stolen database alone can't be used to test guesses. Rotating that secret invalidates every code.
- Codes and reset links work once. Security events are logged by user id, never with the code or password.

Code: `server/recovery/code.ts`, `server/services/recovery.ts`, `server/actions/recovery.ts`,
`scripts/reset-link.mts`.

## Deploying (Vercel)

```bash
vercel --prod
```

The build (`vercel-build` in `package.json`) applies database migrations and the idempotent seed before
`next build`. After a deploy, check that the build log's route table lists every page.

**Never name a route folder `cvs`.** The Vercel CLI always leaves out folders called `CVS` (an old
version-control system) and matches without case, so such a folder silently disappears from the upload and
its page returns 404. That is why the CV page is `/my-cvs` and the upload route is `/api/cv-uploads`
(`/cvs` redirects).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server (real model and live job sources) |
| `npm run dev:offline` / `npm run dev:live-jobs` | Scripted model with demo listings / with live job sources |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm test` | Unit tests (pure code, no database) |
| `npm run test:integration` | Integration tests against `TEST_DATABASE_URL` (it gets truncated) |
| `npm run test:e2e` | Playwright tests against `TEST_DATABASE_URL`, with mocked AI. Stop other `next dev` servers for this folder first |
| `npm run db:migrate` | Create and apply a migration, then regenerate the client |
| `npm run db:seed` | Seed or update the skills taxonomy and company job boards (idempotent) |
| `npm run scrape:check` | Live check of every job source; run before a demo or deploy |
| `npm run reset-link -- <email>` | One-time password reset link (see above) |

## Project layout

```
app/              routes: (marketing) landing, (auth) sign-in and password reset, (app) signed-in pages, api/
components/       UI (components/ui is shadcn); assistant/ is the chat
server/           server-only code
  ai/             agent, prompts, model choice, budget, AI call ledger, offline mocks
  discovery/      job sources: company boards (Greenhouse/Lever/Ashby), GotFriends, Remote OK, Arbeitnow
  tailor/         truthfulness guard, CV structure, DOCX and PDF rebuilt from the CV layout
  recovery/       recovery codes
  services/       authorization lives here: every function takes userId first
prisma/           schema, migrations, seed data
scripts/          scrape check, admin reset link, offline dev
tests/            unit + integration (Vitest)
e2e/              Playwright
```

## AI usage and cost

All model calls go through `server/ai/run.ts`. It checks the user's daily token budget
(`AI_DAILY_TOKEN_LIMIT`), picks the model (Sonnet on the live site, Haiku locally via `AI_REASONING_MODEL`), and
records token counts in the `AiRun` table. Prompts, CV text and responses are never stored. Every call is
paid from the Anthropic API key's credit, so set a monthly spend limit in the Anthropic console.
Tests never call a real model (`AI_MOCK=1`).
