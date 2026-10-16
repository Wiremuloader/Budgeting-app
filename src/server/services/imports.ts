import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Database, Queryable } from "../db";
import { categories, financialAccounts, importBatches, transactions } from "../db/schema";
import { audit, invalid, notFound, ownedAccount } from "./common";
import { createTransactionTx } from "./transactions";
import { detectDelimiter, parseCsv } from "@/domain/csv";
import { guessMapping, mapRows, type ColumnMapping, type MappedRow } from "@/domain/import";
import { fingerprintRows } from "@/domain/duplicates";
import { normalizeMerchant } from "@/domain/merchant";
import { addDays, diffDays, type ISODate } from "@/domain/dates";

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 10_000;

export type RowStatus = "new" | "duplicate" | "possible_duplicate" | "error";

export interface PreviewRow extends MappedRow {
  status: RowStatus;
  fingerprint: string | null;
  merchantName: string;
  categoryId: string | null;
  duplicateOf: string | null;
}

export interface ImportPreview {
  header: string[];
  sample: string[][];
  mapping: ColumnMapping | null;
  rows: PreviewRow[];
  stats: Record<RowStatus, number>;
  fileHash: string;
  previouslyImportedAt: Date | null;
  dateRange: { from: ISODate; to: ISODate } | null;
  beforeOpeningBalance: boolean;
}

function parseFile(text: string): { header: string[]; body: string[][] } {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) throw invalid("File is larger than 2 MB. Split it into smaller files.");
  let rows: string[][];
  try {
    rows = parseCsv(text, detectDelimiter(text));
  } catch (e) {
    throw invalid(`Couldn't read the CSV: ${(e as Error).message}`);
  }
  if (rows.length < 2) throw invalid("The file needs a header row and at least one transaction");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw invalid(`Imports are limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows per file`);
  // Some bank exports put account info above the header; use the first row that looks like a header.
  const headerIdx = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.length >= 3);
  const start = headerIdx >= 0 ? headerIdx : 0;
  return { header: rows[start].map((h) => h.trim()), body: rows.slice(start + 1) };
}

export async function previewImport(db: Queryable, userId: string, input: { accountId: string; text: string; mapping?: ColumnMapping | null }): Promise<ImportPreview> {
  const account = await ownedAccount(db, userId, input.accountId);
  const { header, body } = parseFile(input.text);
  const fileHash = createHash("sha256").update(input.text).digest("hex");
  const mapping = input.mapping ?? guessMapping(header, body.slice(0, 20));
  const [prev] = await db
    .select({ createdAt: importBatches.createdAt })
    .from(importBatches)
    .where(and(eq(importBatches.userId, userId), eq(importBatches.accountId, account.id), eq(importBatches.fileHash, fileHash), eq(importBatches.status, "completed")))
    .orderBy(desc(importBatches.createdAt))
    .limit(1);
  const empty: Record<RowStatus, number> = { new: 0, duplicate: 0, possible_duplicate: 0, error: 0 };
  if (!mapping) {
    return { header, sample: body.slice(0, 5), mapping: null, rows: [], stats: empty, fileHash, previouslyImportedAt: prev?.createdAt ?? null, dateRange: null, beforeOpeningBalance: false };
  }
  validateMapping(mapping, header.length);
  const mapped = mapRows(body, mapping, account.currency);
  const valid = mapped.filter((r) => !r.errors.length) as (MappedRow & { date: ISODate; amount: number })[];
  const withFp = fingerprintRows(account.id, valid);
  const fpByRow = new Map(withFp.map((r) => [r.rowNumber, r.fingerprint]));

  const dates = valid.map((r) => r.date).sort();
  const dateRange = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  const existing = dateRange
    ? await db
        .select({ id: transactions.id, fingerprint: transactions.fingerprint, externalId: transactions.externalId, date: transactions.date, amount: transactions.amount, merchantKey: transactions.merchantKey, kind: transactions.kind })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.accountId, account.id), gte(transactions.date, addDays(dateRange.from, -3)), lte(transactions.date, addDays(dateRange.to, 3))))
    : [];
  const fps = new Set(existing.map((e) => e.fingerprint).filter(Boolean));
  const extIds = new Set(existing.map((e) => e.externalId).filter(Boolean));
  const [opening] = await db
    .select({ date: transactions.date })
    .from(transactions)
    .where(and(eq(transactions.accountId, account.id), eq(transactions.kind, "adjustment"), eq(transactions.merchant, "Opening balance")))
    .limit(1);

  const userCats = mapping.category !== undefined
    ? await db.select({ id: categories.id, name: categories.name }).from(categories).where(and(eq(categories.userId, userId), isNull(categories.archivedAt)))
    : [];

  const rows: PreviewRow[] = mapped.map((r) => {
    const merchantName = normalizeMerchant(r.payee || r.description).name;
    const fingerprint = fpByRow.get(r.rowNumber) ?? null;
    let status: RowStatus = "new";
    let duplicateOf: string | null = null;
    if (r.errors.length) status = "error";
    else if ((fingerprint && fps.has(fingerprint)) || (r.externalId && extIds.has(r.externalId))) status = "duplicate";
    else {
      // Fuzzy: same amount within 2 days of an existing entry with the same merchant or one entered by hand.
      const key = normalizeMerchant(merchantName).key;
      const hit = existing.find(
        (e) => e.amount === r.amount && Math.abs(diffDays(e.date, r.date!)) <= 2 && (e.merchantKey === key || !e.fingerprint),
      );
      if (hit) {
        status = "possible_duplicate";
        duplicateOf = hit.id;
      }
    }
    const categoryId = r.category ? (userCats.find((c) => c.name.toLowerCase() === r.category!.toLowerCase())?.id ?? null) : null;
    return { ...r, status, fingerprint, merchantName, categoryId, duplicateOf };
  });
  const stats = { ...empty };
  for (const r of rows) stats[r.status]++;
  return {
    header,
    sample: body.slice(0, 5),
    mapping,
    rows,
    stats,
    fileHash,
    previouslyImportedAt: prev?.createdAt ?? null,
    dateRange,
    beforeOpeningBalance: Boolean(opening && dateRange && dateRange.from < opening.date),
  };
}

function validateMapping(m: ColumnMapping, columns: number) {
  const idx = [m.date, m.description, m.amount, m.debit, m.credit, m.payee, m.reference, m.notes, m.category, m.externalId, ...(m.descriptionExtra ?? [])];
  for (const i of idx) if (i !== undefined && (!Number.isInteger(i) || i < 0 || i >= columns)) throw invalid("Column mapping doesn't match the file");
  if (m.amount === undefined && (m.debit === undefined || m.credit === undefined)) throw invalid("Choose an amount column, or both debit and credit columns");
  if (!["YMD", "DMY", "MDY"].includes(m.dateFormat)) throw invalid("Unknown date format");
}

export interface CommitResult {
  batchId: string;
  imported: number;
  duplicates: number;
  errors: number;
  skipped: number;
}

/**
 * Import the file. The server re-parses the original text (client-side previews are
 * never trusted) and the whole import runs in one database transaction. Exact duplicates
 * are skipped; the unique (account, fingerprint) index makes concurrent or repeated
 * imports of the same rows a no-op instead of double-counting.
 */
export async function commitImport(
  db: Database,
  userId: string,
  input: { accountId: string; text: string; fileName?: string | null; mapping: ColumnMapping; includePossibleDuplicates?: boolean; excludeRows?: number[] },
): Promise<CommitResult> {
  const preview = await previewImport(db, userId, input);
  if (!preview.mapping) throw invalid("Choose which columns hold the date, description and amount");
  const exclude = new Set(input.excludeRows ?? []);
  const toImport = preview.rows.filter(
    (r) => !exclude.has(r.rowNumber) && (r.status === "new" || (r.status === "possible_duplicate" && input.includePossibleDuplicates)),
  );
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        userId,
        accountId: input.accountId,
        source: "csv",
        fileName: input.fileName?.slice(0, 200) ?? null,
        fileHash: preview.fileHash,
        status: "completed",
        rowCount: preview.rows.length,
        duplicateCount: preview.stats.duplicate,
        errorCount: preview.stats.error,
        mapping: preview.mapping,
      })
      .returning();
    let imported = 0;
    for (const r of toImport) {
      await createTransactionTx(
        tx,
        userId,
        {
          accountId: input.accountId,
          date: r.date!,
          amount: r.amount!,
          merchant: r.merchantName,
          description: r.description,
          notes: [r.notes, r.reference ? `Ref: ${r.reference}` : null].filter(Boolean).join(" · ") || null,
          categoryId: r.categoryId ?? undefined,
          status: "cleared",
          reviewed: false,
          externalId: r.externalId,
          fingerprint: r.fingerprint,
          importBatchId: batch.id,
        },
        "import",
      );
      imported++;
    }
    await tx.update(importBatches).set({ importedCount: imported }).where(eq(importBatches.id, batch.id));
    await audit(tx, userId, "import_batch", batch.id, "import", { rows: preview.rows.length, imported, duplicates: preview.stats.duplicate }, "import");
    return {
      batchId: batch.id,
      imported,
      duplicates: preview.stats.duplicate,
      errors: preview.stats.error,
      skipped: preview.rows.length - imported - preview.stats.duplicate - preview.stats.error,
    };
  });
}

export async function listImportBatches(db: Queryable, userId: string) {
  return db
    .select({ b: importBatches, accountName: financialAccounts.name })
    .from(importBatches)
    .innerJoin(financialAccounts, eq(financialAccounts.id, importBatches.accountId))
    .where(eq(importBatches.userId, userId))
    .orderBy(desc(importBatches.createdAt))
    .limit(20);
}

/** Remove everything a batch imported (reconciled rows are kept and reported). */
export async function undoImport(db: Database, userId: string, batchId: string): Promise<{ removed: number; kept: number }> {
  return db.transaction(async (tx) => {
    const [batch] = await tx.select().from(importBatches).where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)));
    if (!batch) throw notFound("Import");
    if (batch.status === "undone") return { removed: 0, kept: 0 };
    const rows = await tx.select({ id: transactions.id, status: transactions.status, group: transactions.transferGroupId }).from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.importBatchId, batchId)));
    const removable = rows.filter((r) => r.status !== "reconciled");
    const groups = removable.map((r) => r.group).filter(Boolean) as string[];
    if (groups.length) {
      // Linked transfers: return the other side to a standalone transaction.
      await tx
        .update(transactions)
        .set({ kind: "standard", transferGroupId: null, reviewed: false })
        .where(and(eq(transactions.userId, userId), inArray(transactions.transferGroupId, groups), sql`${transactions.importBatchId} is distinct from ${batchId}`));
    }
    if (removable.length) await tx.delete(transactions).where(inArray(transactions.id, removable.map((r) => r.id)));
    await tx.update(importBatches).set({ status: "undone" }).where(eq(importBatches.id, batchId));
    await audit(tx, userId, "import_batch", batchId, "undo", { removed: removable.length });
    return { removed: removable.length, kept: rows.length - removable.length };
  });
}

export interface TransferCandidate {
  outflow: { id: string; date: ISODate; amount: number; merchant: string; accountId: string; accountName: string };
  inflow: { id: string; date: ISODate; amount: number; merchant: string; accountId: string; accountName: string };
}

/**
 * Pairs of unlinked opposite transactions in two of the user's accounts within 3 days —
 * typically a credit-card payment imported from both the bank and card statements.
 * Left unlinked they would count the payment as spending; linking makes them a transfer.
 */
export async function transferCandidates(db: Queryable, userId: string, since: ISODate, limit = 20): Promise<TransferCandidate[]> {
  const rows = await db
    .select({ id: transactions.id, date: transactions.date, amount: transactions.amount, merchant: transactions.merchant, accountId: transactions.accountId, accountName: financialAccounts.name, categoryId: transactions.categoryId })
    .from(transactions)
    .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
    .where(and(eq(transactions.userId, userId), eq(transactions.kind, "standard"), gte(transactions.date, since), isNull(transactions.recurringRuleId)));
  const incomeCats = new Set(
    (await db.select({ id: categories.id }).from(categories).where(and(eq(categories.userId, userId), eq(categories.group, "income")))).map((c) => c.id),
  );
  const outs = rows.filter((r) => r.amount < 0);
  const ins = rows.filter((r) => r.amount > 0 && !(r.categoryId && incomeCats.has(r.categoryId)));
  const used = new Set<string>();
  const pairs: TransferCandidate[] = [];
  for (const o of outs) {
    const match = ins.find((i) => !used.has(i.id) && i.accountId !== o.accountId && i.amount === -o.amount && Math.abs(diffDays(o.date, i.date)) <= 3);
    if (!match) continue;
    used.add(match.id);
    pairs.push({ outflow: o, inflow: match });
    if (pairs.length >= limit) break;
  }
  return pairs;
}
