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

### Scheduled notifications

Notification rules (budget limits, upcoming bills, low-balance forecasts, missing income,
duplicates, price changes, goal milestones) also run when a user opens Overview, but to alert
people who haven't visited, call the scheduler route on a timer:

```
POST /api/cron/notifications        (GET also accepted, for Vercel Cron)
Authorization: Bearer <CRON_SECRET>
```

* Set `CRON_SECRET` to a long random value (`openssl rand -base64 32`). Without it the route
  returns 503; a missing or wrong token returns 401. The route is exempt from the session proxy
  and checks the token in constant time.
* Each call evaluates every onboarded user in batches of 100 and returns
  `{"status":"ok","users":…,"created":…,"digests":…,"failed":…}`. One user's error is logged
  (`notify.sweep_user_failed`) and doesn't stop the run.
* It is idempotent: each notification has a dedupe key, so overlapping or repeated calls never
  duplicate alerts (the anti-spam cap of 5 per run / 15 per day still applies).
* **Daily email digest**: users can turn on *Settings → Notifications → Daily email digest*
  (shown only when `RESEND_API_KEY` + `EMAIL_FROM` are set). Alerts whose channels include
  email are then held and sent as one email on the first run from 07:00 in the user's timezone,
  at most once per local day. Without the digest, email-channel alerts are sent as they are created.
* **Hourly** is the recommended schedule — it catches each timezone's morning digest and keeps
  alerts timely. Run it from one place only (it is safe, just wasteful, to run it from several).

Host cron (any Linux box or the Docker host):

```cron
0 * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://ledger.example.com/api/cron/notifications >/dev/null
```

Kubernetes: a `CronJob` running the same `curl` with `schedule: "0 * * * *"`.
Vercel: add `{"crons":[{"path":"/api/cron/notifications","schedule":"0 * * * *"}]}` to
`vercel.json`; Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when the
variable is set.

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
