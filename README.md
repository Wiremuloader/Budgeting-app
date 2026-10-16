# Ledger

A personal budgeting app built for New Zealand first: envelope and flexible budgets,
transactions with splits/transfers/refunds handled correctly to the cent, recurring
bills and pay, savings goals, debt payoff planning, cash-flow forecasting, reports,
and an assistant that answers questions from Ledger’s own calculations.

> Working name. Not a licensed financial adviser — Ledger gives general budgeting guidance only.

## Quick start (local, no Docker needed)

Requirements: Node.js ≥ 20.9 (developed on 24), npm.

```bash
npm install
cp .env.example .env.local            # then set BETTER_AUTH_SECRET (see below)
npm run dev                           # http://localhost:3000
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

By default the app uses **embedded PostgreSQL (PGlite)** stored in `./.data/pglite`, and
migrates itself on first start. Sign up at `/sign-up`; verification and password-reset
links are printed to the server console in development.

### Demo data

```bash
npm run db:seed        # stop `npm run dev` first (PGlite allows one process)
```

Creates `demo@ledger.test` / `ledger-demo-2026` with six months of realistic NZ sample data.
Sample accounts are clearly badged in the UI and can be removed in **Settings → Your data**.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server (`output: standalone`; see deployment) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm test` | Unit (domain) + integration (services on in-memory Postgres) tests |
| `npm run test:e2e` | Playwright end-to-end tests against a production build (stop `npm run dev` first) |
| `npm run db:generate` | Generate a new SQL migration from `src/server/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:seed` | Demo user + sample data (refuses to run in production) |
| `npm run db:reset` | Delete the local PGlite database |

First e2e run: `npx playwright install chromium`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://…` in production; `pglite:./.data/pglite` locally; `pglite:memory` for throwaway runs |
| `BETTER_AUTH_SECRET` | yes | ≥ 32 random bytes. Signs sessions and tokens |
| `BETTER_AUTH_URL` | yes | Public base URL, e.g. `https://ledger.example.nz` |
| `REQUIRE_EMAIL_VERIFICATION` | no | `true` blocks sign-in until the email is verified (needs email delivery) |
| `RESEND_API_KEY`, `EMAIL_FROM` | prod | Email delivery for verification/reset/alerts. Without them production refuses to send |
| `CRON_SECRET` | no | Bearer token for the notification scheduler route `/api/cron/notifications` (see docs/DEPLOYMENT.md) |
| `ANTHROPIC_API_KEY` | no | Enables the AI assistant. Without it the assistant runs in “direct answers” mode |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5-5` |
| `TOKEN_ENCRYPTION_KEY` | if bank sync | Encrypts provider tokens at rest |
| `MIGRATE_ON_START` | no | `true` runs migrations when a Postgres-backed server boots |
| `DATABASE_SSL`, `DATABASE_POOL_MAX` | no | Postgres TLS / pool size |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error` |

Secrets never belong in source control; `.env*` files are git-ignored except `.env.example`.

## Architecture in one picture

```
src/domain      pure financial engine (money, dates, budgets, recurrence, forecast, debt, goals, CSV)
src/server      db (Drizzle schema + client) · auth (Better Auth) · services (all data access,
                scoped by user id) · actions (validated server actions) · ai · banking · mail · log
src/app         routes: (auth) pages, (app) authenticated pages, api/ route handlers, onboarding
src/components  design system primitives, shell, charts, transaction form
tests/          unit + integration (Vitest, PGlite)       e2e/  Playwright
```

More detail: [docs/PLAN.md](docs/PLAN.md) · [docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md) ·
[docs/DATA_MODEL.md](docs/DATA_MODEL.md) · [docs/CSV_FORMATS.md](docs/CSV_FORMATS.md) ·
[docs/SECURITY.md](docs/SECURITY.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) ·
[docs/ROADMAP.md](docs/ROADMAP.md) (status and known gaps).
