import { and, eq, inArray } from "drizzle-orm";
import type { Queryable } from "../db";
import { auditEvents, categories, financialAccounts } from "../db/schema";
import { assertCents } from "@/domain/money";

export class ServiceError extends Error {
  constructor(
    message: string,
    public code: "not_found" | "invalid" | "conflict" | "forbidden" = "invalid",
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const notFound = (what: string) => new ServiceError(`${what} not found`, "not_found");
export const invalid = (msg: string) => new ServiceError(msg, "invalid");

/** Postgres SUM(bigint) returns numeric → string. Convert exactly and guard the range. */
export function toCents(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v as string);
  return assertCents(n, "database sum");
}

export type AccountRow = typeof financialAccounts.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;

/** Load an account only if it belongs to `userId`. Ownership is never inferred from the id alone. */
export async function ownedAccount(db: Queryable, userId: string, accountId: string): Promise<AccountRow> {
  const [a] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.userId, userId)));
  if (!a) throw notFound("Account");
  return a;
}

export async function ownedCategory(db: Queryable, userId: string, categoryId: string, opts: { allowArchived?: boolean } = {}): Promise<CategoryRow> {
  const [c] = await db.select().from(categories).where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
  if (!c) throw notFound("Category");
  if (c.archivedAt && !opts.allowArchived) throw invalid(`"${c.name}" is archived`);
  return c;
}

export async function ownedCategories(db: Queryable, userId: string, ids: string[]): Promise<Map<string, CategoryRow>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db.select().from(categories).where(and(eq(categories.userId, userId), inArray(categories.id, unique)));
  if (rows.length !== unique.length) throw notFound("Category");
  return new Map(rows.map((r) => [r.id, r]));
}

export type AuditSource = "user" | "import" | "assistant" | "system" | "provider";

export async function audit(
  db: Queryable,
  userId: string,
  entityType: string,
  entityId: string,
  action: string,
  changes?: Record<string, unknown> | null,
  source: AuditSource = "user",
): Promise<void> {
  await db.insert(auditEvents).values({ userId, entityType, entityId, action, changes: changes ?? null, source });
}

/** Field-level diff for audit records. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    if (v === undefined) continue;
    const prev = before[k];
    if (JSON.stringify(prev) !== JSON.stringify(v)) out[k] = { from: prev, to: v };
  }
  return out;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
