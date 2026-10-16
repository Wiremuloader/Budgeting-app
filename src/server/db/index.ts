import path from "node:path";
import fs from "node:fs";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Database client.
 *
 *   DATABASE_URL=postgres://…        → node-postgres pool (production)
 *   DATABASE_URL=pglite:./.data/db   → embedded PGlite on disk (local development)
 *   DATABASE_URL=pglite:memory       → in-memory PGlite (tests)
 *
 * The client is created lazily on first use so that importing server modules
 * (e.g. during `next build`) never opens a database connection.
 */

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run queries: the database or an open transaction. */
export type Queryable = Database | Tx;

type Holder = { db?: Database; kind?: "pg" | "pglite"; close?: () => Promise<void>; ready?: Promise<void> };
const g = globalThis as unknown as { __ledgerDb?: Holder };
const holder: Holder = (g.__ledgerDb ??= {});

export const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "drizzle");

function databaseUrl(): string {
  return process.env.DATABASE_URL || "pglite:./.data/pglite";
}

async function createPglite(target: string): Promise<{ db: Database; close: () => Promise<void> }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  let client: InstanceType<typeof PGlite>;
  if (target === "memory") client = new PGlite();
  else {
    const dir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), target);
    fs.mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  await client.waitReady;
  const db = drizzle(client, { schema }) as unknown as Database;
  return { db, close: () => client.close() };
}

async function createPg(url: string): Promise<{ db: Database; close: () => Promise<void> }> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
  });
  const db = drizzlePg(pool, { schema });
  return { db, close: () => pool.end() };
}

export async function migrate(db: Database, kind: "pg" | "pglite"): Promise<void> {
  if (kind === "pglite") {
    const { migrate: run } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await run(db as any, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate: run } = await import("drizzle-orm/node-postgres/migrator");
    await run(db, { migrationsFolder: MIGRATIONS_DIR });
  }
}

async function init(): Promise<void> {
  const url = databaseUrl();
  if (url.startsWith("pglite:")) {
    const { db, close } = await createPglite(url.slice("pglite:".length));
    holder.db = db;
    holder.kind = "pglite";
    holder.close = close;
    // Embedded dev databases migrate themselves; production runs `npm run db:migrate`.
    await migrate(db, "pglite");
  } else {
    const { db, close } = await createPg(url);
    holder.db = db;
    holder.kind = "pg";
    holder.close = close;
    if (process.env.MIGRATE_ON_START === "true") await migrate(db, "pg");
  }
}

/** Resolve the shared database client, initialising it on first call. */
export async function getDb(): Promise<Database> {
  if (holder.db && !holder.ready) return holder.db;
  holder.ready ??= init().catch((e) => {
    holder.ready = undefined;
    throw e;
  });
  await holder.ready;
  return holder.db!;
}

export function databaseKind(): "pg" | "pglite" | undefined {
  return holder.kind;
}

/** Test hook: install a specific database instance. */
export function setDatabase(db: Database, kind: "pg" | "pglite", close?: () => Promise<void>): void {
  holder.db = db;
  holder.kind = kind;
  holder.close = close;
  holder.ready = Promise.resolve();
}

export async function closeDatabase(): Promise<void> {
  await holder.close?.();
  holder.db = undefined;
  holder.ready = undefined;
  holder.close = undefined;
}

export async function createMemoryDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const res = await createPglite("memory");
  await migrate(res.db, "pglite");
  return res;
}

export { schema };
