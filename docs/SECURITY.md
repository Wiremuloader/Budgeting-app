# Security and privacy

Ledger stores sensitive financial information. This document states what is implemented,
what isn’t, and what an operator must do. **Ledger does not claim compliance with PCI DSS,
SOC 2, ISO 27001 or any privacy law**; it has not been assessed. It does not process card
numbers (only optional last-4 digits for recognition).

## Implemented controls

**Authentication** (Better Auth): scrypt password hashing, minimum 10 characters, database
sessions in HttpOnly, SameSite cookies (`Secure` in production), 14-day expiry with daily
refresh, email verification (optionally mandatory), password reset with 1-hour tokens that
revokes other sessions, TOTP two-step verification with backup codes, session listing and
revocation, password change, and self-service account deletion (requires the password).

**Authorisation**: every page, server action and API route calls `requireUser`/`apiContext`.
All services take the authenticated user id and scope every query by it; referenced ids
(accounts, categories, rules) are re-loaded through ownership checks before use. The proxy
redirect is only a convenience, never the security boundary. Integration and e2e tests cover
cross-user reads, writes, deletes, transfers, imports and exports.

**Input handling**: zod validation on every server action and route; Drizzle parameterised
queries (no string-built SQL; `LIKE` wildcards escaped); React output encoding; the assistant
renders model text as plain text (no HTML injection); CSV exports neutralise formula injection.

**CSRF**: server actions are POST-only with Next.js origin checks; Better Auth validates
origins on its endpoints; cookies are SameSite=Lax.

**Rate limiting**: Better Auth limits sign-in (5/min), sign-up (3/min), password reset
(3/5 min) and TOTP verification (5/min). App limiter: assistant 20/min, imports 30/10 min,
exports 20/min, full export 5/hour. *The app limiter is in-memory per process — use a shared
store (Redis) for multi-instance deployments.*

**Headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy`, HSTS. `poweredByHeader` disabled.

**Secrets**: environment variables only; `.env*` git-ignored. Bank provider tokens (when a
provider is added) are AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY` and never sent to the
browser.

**Logging**: structured JSON; a redactor strips keys like amount, balance, merchant, note,
description, email, token, password. Logs record event names, ids, counts and error classes —
not financial details. `onRequestError` in `src/instrumentation.ts` is the error-monitoring hook.

**Audit trail**: account, transaction, transfer, category, budget, rule, goal, debt, import,
export and preference changes are recorded in `audit_events` with source (user, import,
assistant, system, provider).

**AI**: the assistant can only call read-only tools bound to the signed-in user; it has no
tool that changes data. Budget changes are proposals the user must approve in the UI, which
then calls an authorised server action. Users can turn AI off (Settings → Privacy & AI); with
no API key configured, nothing is sent to an AI provider. Data sent when enabled: the question,
recent conversation turns, and the tool results needed (totals, category/merchant names,
dates; at most 20 transactions per search). No account numbers, emails or credentials.

**Bank connections**: not enabled — no provider ships with Ledger. The interface requires
provider-hosted consent flows; Ledger never asks for internet-banking passwords or PINs.

## Operator responsibilities

* Serve over HTTPS only and set `BETTER_AUTH_URL` to the HTTPS origin.
* Use managed PostgreSQL with **encryption at rest**, TLS (`DATABASE_SSL=true`), automated
  backups and point-in-time recovery. Restrict network access to the database.
* Configure email delivery (`RESEND_API_KEY`, `EMAIL_FROM`) before enabling sign-ups.
* Rotate `BETTER_AUTH_SECRET` if exposed (this signs everyone out).
* Keep dependencies patched (`npm audit`). As of this build, audit findings are limited to
  development-only tooling (`drizzle-kit`’s bundled esbuild dev server; a `braces` advisory in
  `eslint-config-next`’s dependency tree) and do not ship in the production server bundle.
* Publish a privacy notice describing hosting location, sub-processors (database host, email
  provider, Anthropic if AI is enabled), retention and contact details.

## Data retention

* Live data is kept until the user deletes it or their account. Account deletion removes all
  financial rows immediately (cascading deletes).
* Database backups are retained per the hosting provider’s policy; deleted data ages out of
  backups on that schedule. Operators must document this period.
* Notifications, audit events and import batch records are kept for the life of the account
  (pruning is a known gap — see ROADMAP).
* The demo seed must never be run against production (the script refuses unless forced).

## Incident response (outline)

1. Contain: revoke sessions (`DELETE FROM sessions` signs everyone out), rotate
   `BETTER_AUTH_SECRET`, rotate database credentials and API keys.
2. Assess: use `audit_events` and structured logs to determine affected users and data.
3. Notify: affected users and, where required (e.g. NZ Privacy Act 2020 notifiable privacy
   breaches), the Office of the Privacy Commissioner — take legal advice.
4. Remediate and document.

## Known limitations

* No receipt upload UI yet (the `attachments` table exists; upload handling is not built).
* No CAPTCHA/bot protection on sign-up beyond rate limits.
* In-memory app rate limiter (see above). PGlite is single-process and intended for
  development only.
