/**
 * Apply SQL migrations in ./drizzle to DATABASE_URL.
 * Production deploys run this before starting the app (see docs/DEPLOYMENT.md).
 */
import { getDb, closeDatabase, databaseKind, migrate } from "../src/server/db";

async function main() {
  const db = await getDb(); // PGlite migrates on open; for Postgres run explicitly.
  if (databaseKind() === "pg") await migrate(db, "pg");
  console.log(`Migrations applied (${databaseKind()}).`);
  await closeDatabase();
}

main().catch(async (e) => {
  console.error("Migration failed:", e);
  await closeDatabase();
  process.exit(1);
});
