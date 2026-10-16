# Ledger — technical plan

Status: living document. See `docs/ROADMAP.md` for progress against milestones.

## 1. Starting point

The repository was empty. Ledger is built from scratch on the recommended stack.
Docker was not running on the development machine, so local development and the
automated test suite use **PGlite** (PostgreSQL compiled to WASM, real Postgres
semantics, on-disk persistence). Production uses a normal PostgreSQL server via
`DATABASE_URL`. The same Drizzle schema and SQL migrations run on both.

## 2. Product requirements (condensed)

Ledger answers, within seconds of opening it:

| Question | Where | Computed by |
|---|---|---|
| How much money do I have? | Overview → Cash | `domain/balances` |
| How much can I safely spend? | Overview → Safe to spend | `domain/safe-to-spend` |
| Earned / spent / saved this period | Overview → Period summary | `domain/aggregation` |
| What bills are coming? | Overview, Recurring | `domain/recurrence` |
| Am I on track? | Overview, Budget | `domain/budget` |
| Days until payday | Overview | `domain/recurrence` |
| What changed? | Overview → Insights | `domain/insights` |

Non-goals for v1 (documented, not faked): live bank sync (architecture only),
automatic subscription cancellation, investment advice, tax calculation,
multi-currency conversion (each currency is reported separately), household sharing
(schema-ready via `owner` scoping; UI not built).

## 3. Architecture

```
src/
  domain/        Pure TypeScript financial engine. No I/O, no React, no DB.
                 Money (integer minor units), civil dates, budgets, recurrence,
                 forecasting, debt payoff, goals, CSV, merchant normalisation,
                 duplicate detection, insights. 100% unit-tested.
  server/
    db/          Drizzle schema, client (PGlite | node-postgres), migrations.
    auth/        Better Auth configuration + `requireUser()` guard.
    services/    Data access + orchestration. Every function takes `userId`
                 and scopes every query by it. Database transactions here.
    actions/     Next.js server actions: validate input (zod) → requireUser →
                 service call → revalidate. The only mutation entry points for UI.
    ai/          Assistant: tool definitions that wrap services, model adapter,
                 offline fallback router.
    banking/     Bank-connection provider interface; CSV/manual provider.
    notify/      Notification rules + delivery channel interface.
  app/           Routes. (auth) public pages, (app) authenticated shell.
  components/    UI primitives (ui/), shell, charts, feature components.
tests/           Vitest: unit (domain) + integration (services on in-memory PGlite).
e2e/             Playwright.
```

Key decisions:

* **Next.js 16 full-stack** (App Router, server actions, route handlers). No microservices.
* **Drizzle ORM** (type-safe, SQL-first, small) over Prisma (no engine binary; works with PGlite).
* **Better Auth** for email/password, email verification, password reset, TOTP MFA,
  session listing/revocation, account deletion. Not a custom auth implementation.
* **Money = integer cents (`bigint` column, JS `number` guarded by `Number.isSafeInteger`)**;
  products/ratios use `BigInt` intermediates with explicit half-away-from-zero rounding.
* **Calendar dates are strings `YYYY-MM-DD`** in the domain, `date` columns in SQL. "Today"
  is resolved once per request in the user's IANA timezone (default `Pacific/Auckland`).
* **Recharts** for charts, **Radix primitives** + hand-built Tailwind components (shadcn-style).
* Cache Components disabled: every authenticated page is dynamic and per-user; no shared caching.

## 4. Data model

See `docs/DATA_MODEL.md` (ERD + archival rules) and `src/server/db/schema.ts`.

## 5. Financial rules

See `docs/FINANCIAL_RULES.md`. Highlights: signed amounts from the account's point of
view; transfers are two linked legs excluded from income and spending; credit-card
purchases are spending when made, card payments are transfers; refunds are positive
amounts in an expense category; splits must sum exactly to the parent.

## 6. Page map

Overview · Transactions · Budget · Accounts · Goals · Recurring (bills + subscriptions)
· Debt · Reports · Assistant · Settings · Onboarding · Sign in / Sign up / Reset.
Mobile bottom bar: Overview, Transactions, Budget, Assistant, More.

## 7. Milestones

1. Foundations: scaffold, schema + migrations, domain engine + tests, auth.
2. Shell & design system: tokens, themes, sidebar/bottom nav, primitives.
3. Accounts + transactions (CRUD, splits, transfers, filters, bulk, audit).
4. Budget (envelope + flexible), categories, onboarding + starter budget.
5. Recurring, subscriptions, goals, debt.
6. Overview dashboard, insights, forecasting, reports, CSV import/export.
7. Notifications, assistant, banking abstraction.
8. Hardening: security, a11y, e2e, docs, deployment.

## 8. Risks and assumptions

* **No live NZ bank data.** NZ open banking (API Centre standards; providers such as
  Akahu) requires a commercial agreement and app registration. Ledger ships the
  provider interface plus CSV import; no provider is faked.
* **Single process rate limiting** is in-memory; multi-instance deployments need a shared store.
* **PGlite is single-writer**: fine for dev/tests, not for production.
* Forecasts are statistical estimates from limited history and are labelled as such.
