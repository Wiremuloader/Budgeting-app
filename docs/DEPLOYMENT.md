# Deployment

Ledger is a single Next.js 16 service plus PostgreSQL. No other infrastructure is required.

## Option A — Docker Compose (PostgreSQL + app)

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET, TOKEN_ENCRYPTION_KEY, BETTER_AUTH_URL (and email/AI keys if used)
docker compose up --build
```

The app runs migrations on boot (`MIGRATE_ON_START=true`) and exposes `http://localhost:3000`.
Health check: `GET /api/health` → `{"status":"ok","database":"pg"}` (503 if the DB is down).

## Option B — any Node host / container platform

1. Provision PostgreSQL 15+ (managed, encrypted at rest, TLS on).
2. Set environment variables (see README). Required: `DATABASE_URL`, `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL`; strongly recommended: `RESEND_API_KEY` + `EMAIL_FROM`.
3. Build: `npm ci && npm run build` (produces `.next/standalone`).
4. Release step (once per deploy, before new instances take traffic):
   `DATABASE_URL=… npm run db:migrate`.
5. Start: `node .next/standalone/server.js` with `.next/static` copied to
   `.next/standalone/.next/static` and `drizzle/` alongside (the Dockerfile does this).
   `npm start` (`next start`) also works for simple hosts but prints a standalone warning.

### Migrations

* Schema changes: edit `src/server/db/schema.ts` → `npm run db:generate` → commit the new SQL
  in `drizzle/` → deploy → `npm run db:migrate`.
* Migrations are forward-only SQL, applied in order and recorded in `drizzle.__drizzle_migrations`.
  Write backwards-compatible migrations (add columns nullable, backfill, then tighten) so old and
  new app versions can run side by side during a rollout.

### Scaling notes

* Stateless app servers; sessions live in PostgreSQL.
* Replace the in-memory app rate limiter with a shared store before running multiple instances.
* `DATABASE_POOL_MAX` (default 10) per instance.

### Observability

* Logs: JSON lines on stdout/stderr (`level`, `time`, `msg`, fields). Ship them to your log platform.
* Errors: `src/instrumentation.ts › onRequestError` logs every server error with route and digest;
  add Sentry/OpenTelemetry there.
* Health: `/api/health` for load balancers; Docker `HEALTHCHECK` included.

## Local development without Docker

`npm run dev` uses embedded PGlite (`DATABASE_URL=pglite:./.data/pglite`), which migrates
itself. It is single-process: stop the dev server before running `npm run db:seed` or e2e tests.

## Verifying a deployment

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e
```
