import { sql } from "drizzle-orm";
import { getDb, databaseKind } from "@/server/db";
import { log, errorFields } from "@/server/log";

export const dynamic = "force-dynamic";

/** Liveness + database readiness. Returns no user data. */
export async function GET() {
  const started = Date.now();
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", database: databaseKind(), latencyMs: Date.now() - started });
  } catch (e) {
    log.error("health.db_failed", errorFields(e));
    return Response.json({ status: "error", database: "unavailable" }, { status: 503 });
  }
}
