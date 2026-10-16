import type { Instrumentation } from "next";

/**
 * Server start-up hook. Opens the database early so a misconfigured DATABASE_URL
 * fails fast, and runs migrations when MIGRATE_ON_START=true (PGlite always migrates).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("./server/db");
  const { log, errorFields } = await import("./server/log");
  try {
    await getDb();
    log.info("server.ready");
  } catch (e) {
    log.error("server.db_init_failed", errorFields(e));
  }
}

/**
 * Error-monitoring integration point. Logs a structured, redacted record of every
 * server error; forward it to Sentry/OpenTelemetry/etc. here if you use one.
 * Request bodies, cookies and query strings are deliberately not logged.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { log } = await import("./server/log");
  const e = err as Error & { digest?: string };
  log.error("request.error", {
    errorName: e?.name,
    errorMessage: e?.message?.slice(0, 300),
    digest: e?.digest,
    method: request.method,
    path: request.path.split("?")[0],
    routeType: context.routeType,
    routePath: context.routePath,
  });
};
