/**
 * Delete the local embedded database (PGlite only). Refuses to touch a Postgres URL.
 */
import fs from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL || "pglite:./.data/pglite";
if (!url.startsWith("pglite:") || url === "pglite:memory") {
  console.error("db:reset only removes a local PGlite directory. Drop Postgres databases with your own tooling.");
  process.exit(1);
}
const dir = path.resolve(process.cwd(), url.slice("pglite:".length));
if (!dir.startsWith(process.cwd())) {
  console.error("Refusing to delete a directory outside the project.");
  process.exit(1);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}`);
