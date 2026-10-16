import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { Database, Queryable, Tx } from "../db";
import {
  auditEvents,
  categories,
  debtPayments,
  debts,
  financialAccounts,
  merchantRules,
  transactionSplits,
  transactions,
} from "../db/schema";
import { audit, diff, invalid, notFound, ownedAccount, ownedCategories, ownedCategory, ServiceError, toCents, type AuditSource } from "./common";
import { validateSplits, SplitError, transferLegs, type LedgerLine, type TransactionStatus } from "@/domain/ledger";
import { applyMerchantRules, normalizeMerchant } from "@/domain/merchant";
import { assertCents } from "@/domain/money";
import { isValidDate, type DateRange, type ISODate } from "@/domain/dates";
import { autoMatchTransaction } from "./recurring";

export type TransactionRow = typeof transactions.$inferSelect;

export interface SplitPart {
  categoryId: string;
  amount: number;
  notes?: string | null;
}

export interface TransactionInput {
  accountId: string;
  date: ISODate;
  time?: string | null;
  amount: number;
  merchant: string;
  description?: string | null;
  notes?: string | null;
  /** undefined → apply merchant rules / history; null → explicitly uncategorised. */
  categoryId?: string | null;
  status?: TransactionStatus;
  tags?: string[];
  splits?: SplitPart[] | null;
  originalAmount?: number | null;
  originalCurrency?: string | null;
  reviewed?: boolean;
  externalId?: string | null;
  fingerprint?: string | null;
  importBatchId?: string | null;
  isSample?: boolean;
}

function cleanTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter((t) => t && t.length <= 32))].slice(0, 12);
}

function validateBasics(input: { date: ISODate; amount: number; merchant: string; time?: string | null }) {
  if (!isValidDate(input.date)) throw invalid("Invalid date");
  assertCents(input.amount, "amount");
  if (input.amount === 0) throw invalid("Amount can't be zero");
  if (!input.merchant.trim()) throw invalid("Payee is required");
  if (input.merchant.length > 200) throw invalid("Payee is too long");
  if (input.time && !/^[0-2]\d:[0-5]\d$/.test(input.time)) throw invalid("Time must be HH:MM");
}

/** Suggest a category: the user's merchant rules first, then the last category used for this merchant. */
export async function suggestCategory(db: Queryable, userId: string, rawMerchant: string): Promise<{ categoryId: string | null; merchantName: string | null }> {
  const rules = await db.select().from(merchantRules).where(eq(merchantRules.userId, userId));
  const rule = applyMerchantRules(rawMerchant, rules);
  if (rule?.categoryId) return { categoryId: rule.categoryId, merchantName: rule.merchantName ?? null };
  const key = normalizeMerchant(rule?.merchantName ?? rawMerchant).key;
  const [last] = await db
    .select({ categoryId: transactions.categoryId })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.merchantKey, key),
        eq(transactions.kind, "standard"),
        isNull(categories.archivedAt),
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(1);
  return { categoryId: last?.categoryId ?? null, merchantName: rule?.merchantName ?? null };
}

async function insertSplits(tx: Tx, userId: string, transactionId: string, parentAmount: number, splits: SplitPart[]) {
  try {
    validateSplits(parentAmount, splits);
  } catch (e) {
    if (e instanceof SplitError) throw invalid(e.message);
    throw e;
  }
  const cats = await ownedCategories(tx, userId, splits.map((s) => s.categoryId));
  for (const c of cats.values()) if (c.archivedAt) throw invalid(`"${c.name}" is archived`);
  await tx.insert(transactionSplits).values(
    splits.map((s, i) => ({ transactionId, userId, categoryId: s.categoryId, amount: s.amount, notes: s.notes?.trim() || null, sortOrder: i })),
  );
}

export async function createTransactionTx(tx: Tx, userId: string, input: TransactionInput, source: AuditSource = "user"): Promise<TransactionRow> {
  validateBasics(input);
  const account = await ownedAccount(tx, userId, input.accountId);
  if (account.archivedAt) throw invalid("This account is archived");

  let categoryId = input.categoryId;
  let merchantName = input.merchant.trim();
  if (categoryId === undefined) {
    const s = await suggestCategory(tx, userId, input.merchant);
    categoryId = s.categoryId;
    if (s.merchantName) merchantName = s.merchantName;
  }
  const hasSplits = Boolean(input.splits && input.splits.length);
  if (hasSplits) categoryId = null;
  else if (categoryId) await ownedCategory(tx, userId, categoryId);

  const [row] = await tx
    .insert(transactions)
    .values({
      userId,
      accountId: account.id,
      date: input.date,
      time: input.time || null,
      amount: input.amount,
      currency: account.currency,
      originalAmount: input.originalAmount ?? null,
      originalCurrency: input.originalCurrency ?? null,
      merchant: merchantName,
      merchantKey: normalizeMerchant(merchantName).key,
      description: input.description?.trim() || null,
      notes: input.notes?.trim() || null,
      kind: "standard",
      status: input.status ?? "cleared",
      categoryId: categoryId ?? null,
      isSplit: hasSplits,
      tags: cleanTags(input.tags),
      reviewed: input.reviewed ?? source === "user",
      externalId: input.externalId ?? null,
      fingerprint: input.fingerprint ?? null,
      importBatchId: input.importBatchId ?? null,
      isSample: input.isSample ?? false,
    })
    .returning();
  if (hasSplits) await insertSplits(tx, userId, row.id, row.amount, input.splits!);
  await autoMatchTransaction(tx, userId, row);
  await audit(tx, userId, "transaction", row.id, "create", { amount: row.amount, date: row.date, accountId: row.accountId }, source);
  return row;
}

export async function createTransaction(db: Database, userId: string, input: TransactionInput, source: AuditSource = "user"): Promise<TransactionRow> {
  return db.transaction((tx) => createTransactionTx(tx, userId, input, source));
}

/* ------------------------------------------------------------- transfers */

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number; // positive
  date: ISODate;
  notes?: string | null;
  status?: TransactionStatus;
  /** Optional budget category for the outflow leg (e.g. loan repayments). Transfers are never spending in reports. */
  categoryId?: string | null;
  recurringRuleId?: string | null;
  isSample?: boolean;
}

export async function createTransferTx(tx: Tx, userId: string, input: TransferInput, source: AuditSource = "user") {
  if (!isValidDate(input.date)) throw invalid("Invalid date");
  let legs;
  try {
    legs = transferLegs(input.fromAccountId, input.toAccountId, input.amount);
  } catch (e) {
    throw invalid((e as Error).message);
  }
  const from = await ownedAccount(tx, userId, input.fromAccountId);
  const to = await ownedAccount(tx, userId, input.toAccountId);
  if (from.archivedAt || to.archivedAt) throw invalid("Can't transfer with an archived account");
  if (from.currency !== to.currency) throw invalid("Transfers between different currencies aren't supported yet");
  if (input.categoryId) await ownedCategory(tx, userId, input.categoryId);
  const groupId = crypto.randomUUID();
  const common = {
    userId,
    date: input.date,
    currency: from.currency,
    kind: "transfer" as const,
    status: input.status ?? "cleared",
    transferGroupId: groupId,
    notes: input.notes?.trim() || null,
    reviewed: true,
    isSample: input.isSample ?? false,
  };
  const [outLeg, inLeg] = await tx
    .insert(transactions)
    .values([
      {
        ...common,
        accountId: from.id,
        amount: legs.from.amount,
        merchant: `Transfer to ${to.name}`,
        merchantKey: normalizeMerchant(`Transfer to ${to.name}`).key,
        categoryId: input.categoryId ?? null,
        recurringRuleId: input.recurringRuleId ?? null,
      },
      {
        ...common,
        accountId: to.id,
        amount: legs.to.amount,
        merchant: `Transfer from ${from.name}`,
        merchantKey: normalizeMerchant(`Transfer from ${from.name}`).key,
      },
    ])
    .returning();
  const [debt] = await tx.select().from(debts).where(and(eq(debts.accountId, to.id), eq(debts.userId, userId)));
  if (debt) {
    await tx.insert(debtPayments).values({ debtId: debt.id, userId, transactionId: inLeg.id, date: input.date, amount: input.amount });
  }
  await autoMatchTransaction(tx, userId, outLeg);
  await audit(tx, userId, "transfer", groupId, "create", { from: from.id, to: to.id, amount: input.amount, date: input.date }, source);
  return { groupId, outLeg, inLeg };
}

export async function createTransfer(db: Database, userId: string, input: TransferInput, source: AuditSource = "user") {
  return db.transaction((tx) => createTransferTx(tx, userId, input, source));
}

/** Pair two existing opposite transactions (e.g. both sides imported from CSV) into one transfer. */
export async function linkAsTransfer(db: Database, userId: string, aId: string, bId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, [aId, bId])));
    if (rows.length !== 2) throw notFound("Transaction");
    const [a, b] = rows;
    if (a.kind !== "standard" || b.kind !== "standard") throw invalid("Only regular transactions can be linked");
    if (a.accountId === b.accountId) throw invalid("Both sides are in the same account");
    if (a.amount !== -b.amount) throw invalid("Amounts must be equal and opposite");
    if (a.currency !== b.currency) throw invalid("Currencies differ");
    const groupId = crypto.randomUUID();
    await tx.delete(transactionSplits).where(inArray(transactionSplits.transactionId, [a.id, b.id]));
    await tx
      .update(transactions)
      .set({ kind: "transfer", transferGroupId: groupId, categoryId: null, isSplit: false, reviewed: true })
      .where(and(eq(transactions.userId, userId), inArray(transactions.id, [a.id, b.id])));
    const inLeg = a.amount > 0 ? a : b;
    const [debt] = await tx.select().from(debts).where(and(eq(debts.accountId, inLeg.accountId), eq(debts.userId, userId)));
    if (debt) {
      await tx
        .insert(debtPayments)
        .values({ debtId: debt.id, userId, transactionId: inLeg.id, date: inLeg.date, amount: inLeg.amount })
        .onConflictDoNothing();
    }
    await audit(tx, userId, "transfer", groupId, "link", { transactions: [a.id, b.id] });
  });
}

/** Turn a transfer back into two independent, uncategorised transactions. */
export async function unlinkTransfer(db: Database, userId: string, transactionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await ownedTransaction(tx, userId, transactionId);
    if (t.kind !== "transfer" || !t.transferGroupId) throw invalid("Not a transfer");
    await tx
      .update(transactions)
      .set({ kind: "standard", transferGroupId: null, categoryId: null, reviewed: false })
      .where(and(eq(transactions.userId, userId), eq(transactions.transferGroupId, t.transferGroupId)));
    await tx.delete(debtPayments).where(eq(debtPayments.transactionId, t.id));
    await audit(tx, userId, "transfer", t.transferGroupId, "unlink");
  });
}

/* ---------------------------------------------------------------- update */

export async function ownedTransaction(db: Queryable, userId: string, id: string): Promise<TransactionRow> {
  const [t] = await db.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
  if (!t) throw notFound("Transaction");
  return t;
}

export interface TransactionPatch {
  accountId?: string;
  date?: ISODate;
  time?: string | null;
  amount?: number;
  merchant?: string;
  description?: string | null;
  notes?: string | null;
  categoryId?: string | null;
  status?: TransactionStatus;
  tags?: string[];
  reviewed?: boolean;
  /** Replace splits; `null` removes the split and uses `categoryId`. */
  splits?: SplitPart[] | null;
  /** Optimistic concurrency: reject the update if the row changed since this timestamp. */
  expectedUpdatedAt?: string;
}

export async function updateTransaction(db: Database, userId: string, id: string, patch: TransactionPatch, source: AuditSource = "user"): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await ownedTransaction(tx, userId, id);
    if (patch.expectedUpdatedAt && new Date(patch.expectedUpdatedAt).getTime() !== t.updatedAt.getTime()) {
      throw new ServiceError("This transaction was changed elsewhere. Reload and try again.", "conflict");
    }
    if (t.status === "reconciled" && (patch.amount !== undefined || patch.date !== undefined || patch.accountId !== undefined)) {
      throw invalid("Reconciled transactions can't change amount, date or account. Mark it cleared first.");
    }

    if (t.kind === "transfer") {
      await updateTransfer(tx, userId, t, patch, source);
      return;
    }

    const next = {
      accountId: patch.accountId,
      date: patch.date,
      time: patch.time === undefined ? undefined : patch.time || null,
      amount: patch.amount,
      merchant: patch.merchant?.trim(),
      merchantKey: patch.merchant ? normalizeMerchant(patch.merchant).key : undefined,
      description: patch.description === undefined ? undefined : patch.description?.trim() || null,
      notes: patch.notes === undefined ? undefined : patch.notes?.trim() || null,
      status: patch.status,
      tags: patch.tags ? cleanTags(patch.tags) : undefined,
      reviewed: patch.reviewed,
      categoryId: patch.categoryId,
      isSplit: undefined as boolean | undefined,
    };
    validateBasics({
      date: next.date ?? t.date,
      amount: next.amount ?? t.amount,
      merchant: next.merchant ?? t.merchant,
      time: next.time === undefined ? t.time : next.time,
    });
    if (t.kind === "adjustment" && (patch.categoryId || patch.splits)) throw invalid("Balance adjustments can't be categorised");
    if (next.accountId && next.accountId !== t.accountId) {
      const target = await ownedAccount(tx, userId, next.accountId);
      if (target.currency !== t.currency) throw invalid("Can't move a transaction to an account in another currency");
      if (target.archivedAt) throw invalid("That account is archived");
    }
    if (patch.categoryId) await ownedCategory(tx, userId, patch.categoryId);

    const amount = next.amount ?? t.amount;
    if (patch.splits !== undefined) {
      await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, t.id));
      if (patch.splits && patch.splits.length) {
        await insertSplits(tx, userId, t.id, amount, patch.splits);
        next.isSplit = true;
        next.categoryId = null;
      } else {
        next.isSplit = false;
      }
    } else if (t.isSplit && patch.amount !== undefined && patch.amount !== t.amount) {
      throw invalid("Update the split amounts together with the total");
    } else if (t.isSplit && patch.categoryId) {
      await tx.delete(transactionSplits).where(eq(transactionSplits.transactionId, t.id));
      next.isSplit = false;
    }

    const values = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    if (Object.keys(values).length) {
      await tx.update(transactions).set(values).where(and(eq(transactions.id, t.id), eq(transactions.userId, userId)));
    }
    await audit(tx, userId, "transaction", t.id, "update", { ...diff(t, values), ...(patch.splits !== undefined ? { splits: patch.splits } : {}) }, source);
  });
}

async function updateTransfer(tx: Tx, userId: string, t: TransactionRow, patch: TransactionPatch, source: AuditSource) {
  const legs = await tx
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.transferGroupId, t.transferGroupId!)));
  const out = legs.find((l) => l.amount < 0)!;
  const inn = legs.find((l) => l.amount > 0)!;
  if (patch.splits || patch.accountId) throw invalid("Edit the transfer's accounts by deleting and re-creating it");
  if (patch.amount !== undefined) {
    assertCents(patch.amount);
    if (patch.amount === 0) throw invalid("Amount can't be zero");
  }
  if (patch.date && !isValidDate(patch.date)) throw invalid("Invalid date");
  const magnitude = patch.amount !== undefined ? Math.abs(patch.amount) : null;
  const shared = Object.fromEntries(
    Object.entries({
      date: patch.date,
      notes: patch.notes === undefined ? undefined : patch.notes?.trim() || null,
      status: patch.status,
      tags: patch.tags ? cleanTags(patch.tags) : undefined,
    }).filter(([, v]) => v !== undefined),
  );
  if (patch.categoryId) await ownedCategory(tx, userId, patch.categoryId);
  await tx
    .update(transactions)
    .set({ ...shared, ...(magnitude ? { amount: -magnitude } : {}), ...(patch.categoryId !== undefined ? { categoryId: patch.categoryId } : {}) })
    .where(eq(transactions.id, out.id));
  await tx
    .update(transactions)
    .set({ ...shared, ...(magnitude ? { amount: magnitude } : {}) })
    .where(eq(transactions.id, inn.id));
  if (magnitude || patch.date) {
    await tx
      .update(debtPayments)
      .set({ ...(magnitude ? { amount: magnitude } : {}), ...(patch.date ? { date: patch.date } : {}) })
      .where(eq(debtPayments.transactionId, inn.id));
  }
  await audit(tx, userId, "transfer", t.transferGroupId!, "update", { ...shared, amount: magnitude ?? undefined, categoryId: patch.categoryId }, source);
}

/* ---------------------------------------------------------------- delete */

export async function deleteTransaction(db: Database, userId: string, id: string, source: AuditSource = "user"): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await ownedTransaction(tx, userId, id);
    if (t.status === "reconciled") throw invalid("Reconciled transactions can't be deleted. Mark it cleared first.");
    const where = t.transferGroupId
      ? and(eq(transactions.userId, userId), eq(transactions.transferGroupId, t.transferGroupId))
      : and(eq(transactions.userId, userId), eq(transactions.id, t.id));
    const removed = await tx.delete(transactions).where(where).returning();
    await audit(
      tx,
      userId,
      t.transferGroupId ? "transfer" : "transaction",
      t.transferGroupId ?? t.id,
      "delete",
      { snapshot: removed.map((r) => ({ id: r.id, date: r.date, amount: r.amount, accountId: r.accountId, merchant: r.merchant, categoryId: r.categoryId })) },
      source,
    );
  });
}

/* ------------------------------------------------------------------ bulk */

export async function bulkUpdate(
  db: Database,
  userId: string,
  ids: string[],
  patch: { categoryId?: string | null; reviewed?: boolean; status?: "pending" | "cleared"; addTag?: string },
): Promise<{ updated: number; skipped: number }> {
  if (!ids.length) return { updated: 0, skipped: 0 };
  if (ids.length > 500) throw invalid("Select at most 500 transactions at a time");
  return db.transaction(async (tx) => {
    if (patch.categoryId) await ownedCategory(tx, userId, patch.categoryId);
    const rows = await tx.select().from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)));
    let eligible = rows;
    if (patch.categoryId !== undefined) eligible = eligible.filter((r) => r.kind === "standard" && !r.isSplit);
    if (patch.status) eligible = eligible.filter((r) => r.status !== "reconciled");
    const targetIds = eligible.map((r) => r.id);
    if (targetIds.length) {
      const set: Record<string, unknown> = {};
      if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
      if (patch.reviewed !== undefined) set.reviewed = patch.reviewed;
      if (patch.status) set.status = patch.status;
      if (patch.addTag) {
        const tag = cleanTags([patch.addTag])[0];
        if (tag) set.tags = sql`(select array(select distinct unnest(${transactions.tags} || ARRAY[${tag}]::text[])))`;
      }
      if (Object.keys(set).length) {
        await tx.update(transactions).set(set).where(and(eq(transactions.userId, userId), inArray(transactions.id, targetIds)));
      }
      await audit(tx, userId, "transaction", "bulk", "bulk_update", { ids: targetIds, patch });
    }
    return { updated: targetIds.length, skipped: ids.length - targetIds.length };
  });
}

export async function bulkDelete(db: Database, userId: string, ids: string[]): Promise<{ deleted: number; skipped: number }> {
  if (ids.length > 500) throw invalid("Select at most 500 transactions at a time");
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(transactions).where(and(eq(transactions.userId, userId), inArray(transactions.id, ids)));
    const deletable = rows.filter((r) => r.status !== "reconciled");
    const groups = [...new Set(deletable.map((r) => r.transferGroupId).filter(Boolean))] as string[];
    const singles = deletable.filter((r) => !r.transferGroupId).map((r) => r.id);
    const conditions: SQL[] = [];
    if (singles.length) conditions.push(inArray(transactions.id, singles));
    if (groups.length) conditions.push(inArray(transactions.transferGroupId, groups));
    let deleted = 0;
    if (conditions.length) {
      const removed = await tx
        .delete(transactions)
        .where(and(eq(transactions.userId, userId), or(...conditions)))
        .returning({ id: transactions.id, amount: transactions.amount, date: transactions.date });
      deleted = removed.length;
      await audit(tx, userId, "transaction", "bulk", "bulk_delete", { snapshot: removed });
    }
    return { deleted, skipped: rows.length - deletable.length + (ids.length - rows.length) };
  });
}

export async function saveMerchantRule(db: Database, userId: string, input: { pattern: string; merchantName?: string | null; categoryId?: string | null }) {
  const pattern = input.pattern.trim().toLowerCase();
  if (pattern.length < 3) throw invalid("Pattern must be at least 3 characters");
  if (input.categoryId) await ownedCategory(db, userId, input.categoryId);
  await db
    .insert(merchantRules)
    .values({ userId, pattern, merchantName: input.merchantName?.trim() || null, categoryId: input.categoryId ?? null })
    .onConflictDoUpdate({
      target: [merchantRules.userId, merchantRules.pattern],
      set: { merchantName: input.merchantName?.trim() || null, categoryId: input.categoryId ?? null },
    });
}

/* ------------------------------------------------------------------ list */

export type TypeFilter = "income" | "expense" | "refund" | "transfer" | "adjustment" | "uncategorised";

export interface TransactionFilters {
  q?: string;
  from?: ISODate;
  to?: ISODate;
  accountId?: string;
  categoryId?: string | "none";
  type?: TypeFilter;
  status?: TransactionStatus;
  reviewed?: boolean;
  minAmount?: number; // absolute, cents
  maxAmount?: number;
  tag?: string;
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "merchant";
  page?: number;
  pageSize?: number;
}

export interface TransactionListItem extends TransactionRow {
  accountName: string;
  categoryName: string | null;
  categoryGroup: "income" | "expense" | null;
  splits: { categoryId: string; categoryName: string; amount: number; notes: string | null }[];
  transferCounterpart: { accountId: string; accountName: string } | null;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function filterConditions(userId: string, f: TransactionFilters): SQL[] {
  const c: SQL[] = [eq(transactions.userId, userId)];
  if (f.from) c.push(gte(transactions.date, f.from));
  if (f.to) c.push(lte(transactions.date, f.to));
  if (f.accountId) c.push(eq(transactions.accountId, f.accountId));
  if (f.status) c.push(eq(transactions.status, f.status));
  if (f.reviewed !== undefined) c.push(eq(transactions.reviewed, f.reviewed));
  if (f.minAmount !== undefined) c.push(sql`abs(${transactions.amount}) >= ${f.minAmount}`);
  if (f.maxAmount !== undefined) c.push(sql`abs(${transactions.amount}) <= ${f.maxAmount}`);
  if (f.tag) c.push(sql`${f.tag} = any(${transactions.tags})`);
  if (f.q?.trim()) {
    const pattern = `%${escapeLike(f.q.trim())}%`;
    c.push(or(ilike(transactions.merchant, pattern), ilike(transactions.description, pattern), ilike(transactions.notes, pattern))!);
  }
  if (f.categoryId === "none") {
    c.push(and(eq(transactions.kind, "standard"), isNull(transactions.categoryId), eq(transactions.isSplit, false))!);
  } else if (f.categoryId) {
    c.push(
      or(
        eq(transactions.categoryId, f.categoryId),
        sql`exists (select 1 from ${transactionSplits} s where s.transaction_id = ${transactions.id} and s.category_id = ${f.categoryId})`,
      )!,
    );
  }
  const groupOf = sql`(select c.group from ${categories} c where c.id = ${transactions.categoryId})`;
  switch (f.type) {
    case "transfer":
      c.push(eq(transactions.kind, "transfer"));
      break;
    case "adjustment":
      c.push(eq(transactions.kind, "adjustment"));
      break;
    case "income":
      c.push(and(eq(transactions.kind, "standard"), sql`${groupOf} = 'income'`)!);
      break;
    case "expense":
      c.push(and(eq(transactions.kind, "standard"), sql`${transactions.amount} < 0`, or(sql`${groupOf} = 'expense'`, eq(transactions.isSplit, true), isNull(transactions.categoryId))!)!);
      break;
    case "refund":
      c.push(and(eq(transactions.kind, "standard"), sql`${transactions.amount} > 0`, sql`${groupOf} = 'expense'`)!);
      break;
    case "uncategorised":
      c.push(and(eq(transactions.kind, "standard"), isNull(transactions.categoryId), eq(transactions.isSplit, false))!);
      break;
  }
  return c;
}

export async function listTransactions(db: Queryable, userId: string, f: TransactionFilters = {}) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200);
  const page = Math.max(f.page ?? 1, 1);
  const where = and(...filterConditions(userId, f));
  const order = {
    date_desc: [desc(transactions.date), desc(transactions.time), desc(transactions.createdAt)],
    date_asc: [asc(transactions.date), asc(transactions.time), asc(transactions.createdAt)],
    amount_desc: [desc(transactions.amount), desc(transactions.date)],
    amount_asc: [asc(transactions.amount), desc(transactions.date)],
    merchant: [asc(transactions.merchant), desc(transactions.date)],
  }[f.sort ?? "date_desc"];

  const [rows, [agg]] = await Promise.all([
    db
      .select({ t: transactions, accountName: financialAccounts.name, categoryName: categories.name, categoryGroup: categories.group })
      .from(transactions)
      .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({
        count: sql<number>`count(*)::int`,
        inflow: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.amount} > 0), 0)`,
        outflow: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.amount} < 0), 0)`,
      })
      .from(transactions)
      .where(where),
  ]);

  const ids = rows.map((r) => r.t.id);
  const splitIds = rows.filter((r) => r.t.isSplit).map((r) => r.t.id);
  const groupIds = rows.map((r) => r.t.transferGroupId).filter(Boolean) as string[];
  const [splitRows, counterparts] = await Promise.all([
    splitIds.length
      ? db
          .select({ s: transactionSplits, categoryName: categories.name })
          .from(transactionSplits)
          .innerJoin(categories, eq(categories.id, transactionSplits.categoryId))
          .where(and(eq(transactionSplits.userId, userId), inArray(transactionSplits.transactionId, splitIds)))
          .orderBy(asc(transactionSplits.sortOrder))
      : Promise.resolve([]),
    groupIds.length
      ? db
          .select({ id: transactions.id, groupId: transactions.transferGroupId, accountId: transactions.accountId, accountName: financialAccounts.name })
          .from(transactions)
          .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
          .where(and(eq(transactions.userId, userId), inArray(transactions.transferGroupId, groupIds)))
      : Promise.resolve([]),
  ]);

  const items: TransactionListItem[] = rows.map((r) => ({
    ...r.t,
    accountName: r.accountName,
    categoryName: r.categoryName,
    categoryGroup: r.categoryGroup,
    splits: splitRows
      .filter((s) => s.s.transactionId === r.t.id)
      .map((s) => ({ categoryId: s.s.categoryId, categoryName: s.categoryName, amount: s.s.amount, notes: s.s.notes })),
    transferCounterpart: (() => {
      const other = counterparts.find((c) => c.groupId === r.t.transferGroupId && c.id !== r.t.id);
      return other ? { accountId: other.accountId, accountName: other.accountName } : null;
    })(),
  }));

  return {
    items,
    ids,
    page,
    pageSize,
    total: agg.count,
    pages: Math.max(Math.ceil(agg.count / pageSize), 1),
    inflow: toCents(agg.inflow),
    outflow: toCents(agg.outflow),
  };
}

export async function transactionHistory(db: Queryable, userId: string, id: string) {
  const t = await ownedTransaction(db, userId, id);
  const entityIds = [t.id, ...(t.transferGroupId ? [t.transferGroupId] : [])];
  return db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.userId, userId), inArray(auditEvents.entityId, entityIds)))
    .orderBy(desc(auditEvents.createdAt))
    .limit(50);
}

/* ---------------------------------------------------------- ledger lines */

export interface LineOptions {
  accountIds?: string[];
  categoryIds?: string[];
  /** Include categorised transfer legs (budget activity). Reports leave these out. */
  includeCategorisedTransfers?: boolean;
  kinds?: ("standard" | "transfer" | "adjustment")[];
}

export interface LedgerLineWithMeta extends LedgerLine {
  merchant: string;
  merchantKey: string;
  recurringRuleId: string | null;
  accountType: string;
}

/**
 * Categorised lines for a date range: one per unsplit transaction, one per split part.
 * This is the single source for income/spending/budget aggregation.
 */
export async function ledgerLines(db: Queryable, userId: string, range: DateRange, opts: LineOptions = {}): Promise<LedgerLineWithMeta[]> {
  const kinds = opts.kinds ?? ["standard", "transfer", "adjustment"];
  const rows = await db
    .select({
      transactionId: transactions.id,
      date: transactions.date,
      accountId: transactions.accountId,
      accountType: financialAccounts.type,
      kind: transactions.kind,
      status: transactions.status,
      merchant: transactions.merchant,
      merchantKey: transactions.merchantKey,
      recurringRuleId: transactions.recurringRuleId,
      amount: sql<string>`coalesce(${transactionSplits.amount}, ${transactions.amount})`,
      categoryId: sql<string | null>`coalesce(${transactionSplits.categoryId}, ${transactions.categoryId})`,
      categoryGroup: categories.group,
    })
    .from(transactions)
    .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
    .leftJoin(transactionSplits, eq(transactionSplits.transactionId, transactions.id))
    .leftJoin(categories, sql`${categories.id} = coalesce(${transactionSplits.categoryId}, ${transactions.categoryId})`)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.date, range.from),
        lte(transactions.date, range.to),
        inArray(transactions.kind, kinds),
        opts.accountIds?.length ? inArray(transactions.accountId, opts.accountIds) : undefined,
        opts.includeCategorisedTransfers ? undefined : ne(transactions.kind, "transfer"),
      ),
    )
    .orderBy(asc(transactions.date));
  const lines = rows.map((r) => ({
    ...r,
    amount: toCents(r.amount),
    // A categorised transfer leg is budget activity in an expense category.
    categoryGroup: r.categoryGroup,
  }));
  return opts.categoryIds?.length ? lines.filter((l) => l.categoryId && opts.categoryIds!.includes(l.categoryId)) : lines;
}

/** For the transfer kind, include only categorised legs (and the "kinds" filter keeps others). */
export function budgetActivityLines(lines: LedgerLineWithMeta[]): LedgerLineWithMeta[] {
  return lines.filter((l) => l.kind === "standard" || (l.kind === "transfer" && l.categoryId !== null));
}
