import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Database, Queryable } from "../db";
import { debts, financialAccounts, savingsGoals, transactions, ACCOUNT_TYPES } from "../db/schema";
import { audit, diff, invalid, ownedAccount, toCents, type AccountRow } from "./common";
import { isCash, reconcile, totals, type AccountType, type Totals } from "@/domain/ledger";
import { add, assertCents } from "@/domain/money";
import { normalizeMerchant } from "@/domain/merchant";
import type { ISODate } from "@/domain/dates";

export interface AccountWithBalance extends AccountRow {
  balance: number;
  clearedBalance: number;
  pendingBalance: number;
  transactionCount: number;
  lastTransactionDate: ISODate | null;
  hasDebtProfile: boolean;
}

export async function listAccounts(db: Queryable, userId: string, opts: { includeArchived?: boolean } = {}): Promise<AccountWithBalance[]> {
  const balances = db
    .select({
      accountId: transactions.accountId,
      current: sql<string>`coalesce(sum(${transactions.amount}), 0)`.as("current"),
      pending: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'pending'), 0)`.as("pending"),
      count: sql<number>`count(*)::int`.as("count"),
      last: sql<string | null>`max(${transactions.date})`.as("last"),
    })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .groupBy(transactions.accountId)
    .as("b");

  const rows = await db
    .select({ a: financialAccounts, current: balances.current, pending: balances.pending, count: balances.count, last: balances.last, debtId: debts.id })
    .from(financialAccounts)
    .leftJoin(balances, eq(balances.accountId, financialAccounts.id))
    .leftJoin(debts, eq(debts.accountId, financialAccounts.id))
    .where(and(eq(financialAccounts.userId, userId), opts.includeArchived ? undefined : isNull(financialAccounts.archivedAt)))
    .orderBy(asc(financialAccounts.sortOrder), asc(financialAccounts.createdAt));

  return rows.map(({ a, debtId, ...b }) => {
    const current = toCents(b.current);
    const pending = toCents(b.pending);
    return {
      ...a,
      balance: current,
      clearedBalance: add(current, -pending),
      pendingBalance: pending,
      transactionCount: b.count ?? 0,
      lastTransactionDate: b.last ?? null,
      hasDebtProfile: Boolean(debtId),
    };
  });
}

export function accountTotals(accounts: AccountWithBalance[], currency: string): Totals {
  return totals(
    accounts.map((a) => ({
      id: a.id,
      type: a.type,
      currency: a.currency,
      balance: a.balance,
      includeInNetWorth: a.includeInNetWorth,
      spendable: a.spendable,
      archived: Boolean(a.archivedAt),
    })),
    currency,
  );
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  currency: string;
  institution?: string | null;
  mask?: string | null;
  openingBalance: number;
  openingDate: ISODate;
  spendable?: boolean;
  includeInNetWorth?: boolean;
  onBudget?: boolean;
  isSample?: boolean;
}

export function defaultSpendable(type: AccountType): boolean {
  return type === "checking" || type === "cash";
}

export async function createAccount(db: Database, userId: string, input: CreateAccountInput): Promise<AccountRow> {
  if (!ACCOUNT_TYPES.includes(input.type)) throw invalid("Unknown account type");
  // Signed per the ledger convention: a liability with money owed has a negative balance.
  assertCents(input.openingBalance, "opening balance");
  return db.transaction(async (tx) => {
    const [{ maxOrder }] = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${financialAccounts.sortOrder}), -1)::int` })
      .from(financialAccounts)
      .where(eq(financialAccounts.userId, userId));
    const [account] = await tx
      .insert(financialAccounts)
      .values({
        userId,
        name: input.name.trim(),
        type: input.type,
        currency: input.currency,
        institution: input.institution?.trim() || null,
        mask: input.mask?.trim() || null,
        spendable: input.spendable ?? defaultSpendable(input.type),
        includeInNetWorth: input.includeInNetWorth ?? true,
        onBudget: input.onBudget ?? isCash(input.type),
        sortOrder: maxOrder + 1,
        isSample: input.isSample ?? false,
      })
      .returning();
    if (input.openingBalance !== 0) {
      const m = normalizeMerchant("Opening balance");
      await tx.insert(transactions).values({
        userId,
        accountId: account.id,
        date: input.openingDate,
        amount: input.openingBalance,
        currency: account.currency,
        merchant: "Opening balance",
        merchantKey: m.key,
        kind: "adjustment",
        status: "reconciled",
        reviewed: true,
        notes: "Starting balance entered when the account was added",
        isSample: input.isSample ?? false,
      });
    }
    await audit(tx, userId, "account", account.id, "create", { name: account.name, type: account.type });
    return account;
  });
}

export interface UpdateAccountInput {
  name?: string;
  institution?: string | null;
  mask?: string | null;
  spendable?: boolean;
  includeInNetWorth?: boolean;
  onBudget?: boolean;
  color?: string | null;
}

export async function updateAccount(db: Database, userId: string, accountId: string, patch: UpdateAccountInput): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await ownedAccount(tx, userId, accountId);
    const values = { ...patch, name: patch.name?.trim() };
    await tx.update(financialAccounts).set(values).where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.userId, userId)));
    await audit(tx, userId, "account", accountId, "update", diff(before, values));
  });
}

/**
 * Archiving hides an account from totals and pickers but keeps every historical
 * transaction in reports. Accounts with history can't be deleted, only archived.
 */
export async function setAccountArchived(db: Database, userId: string, accountId: string, archived: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await ownedAccount(tx, userId, accountId);
    await tx
      .update(financialAccounts)
      .set({ archivedAt: archived ? new Date() : null })
      .where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.userId, userId)));
    await audit(tx, userId, "account", accountId, archived ? "archive" : "unarchive");
  });
}

export async function deleteAccount(db: Database, userId: string, accountId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await ownedAccount(tx, userId, accountId);
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, userId), sql`${transactions.kind} <> 'adjustment'`));
    if (n > 0) throw invalid("This account has transactions. Archive it instead to keep your history.");
    await tx.delete(transactions).where(and(eq(transactions.accountId, accountId), eq(transactions.userId, userId)));
    await tx.delete(financialAccounts).where(and(eq(financialAccounts.id, accountId), eq(financialAccounts.userId, userId)));
    await audit(tx, userId, "account", accountId, "delete");
  });
}

export async function reorderAccounts(db: Database, userId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, id] of orderedIds.entries()) {
      await tx
        .update(financialAccounts)
        .set({ sortOrder: i })
        .where(and(eq(financialAccounts.id, id), eq(financialAccounts.userId, userId)));
    }
  });
}

export async function accountBalanceAsOf(db: Queryable, userId: string, accountId: string, date?: ISODate, clearedOnly = false) {
  const [{ total }] = await db
    .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.userId, userId),
        date ? lte(transactions.date, date) : undefined,
        clearedOnly ? sql`${transactions.status} <> 'pending'` : undefined,
      ),
    );
  return toCents(total);
}

/**
 * Manual balance adjustment: records the difference as an auditable "adjustment"
 * transaction with the user's explanation. Adjustments never count as income or spending.
 */
export async function adjustBalance(
  db: Database,
  userId: string,
  accountId: string,
  input: { newBalance: number; date: ISODate; reason: string },
): Promise<{ difference: number }> {
  assertCents(input.newBalance);
  const reason = input.reason.trim();
  if (reason.length < 3) throw invalid("Please explain the adjustment");
  return db.transaction(async (tx) => {
    const account = await ownedAccount(tx, userId, accountId);
    const current = await accountBalanceAsOf(tx, userId, accountId, input.date);
    const difference = add(input.newBalance, -current);
    if (difference === 0) return { difference };
    const [t] = await tx
      .insert(transactions)
      .values({
        userId,
        accountId,
        date: input.date,
        amount: difference,
        currency: account.currency,
        merchant: "Balance adjustment",
        merchantKey: "balance adjustment",
        notes: reason,
        kind: "adjustment",
        status: "cleared",
        reviewed: true,
      })
      .returning({ id: transactions.id });
    await audit(tx, userId, "account", accountId, "adjust_balance", { transactionId: t.id, from: current, to: input.newBalance, reason });
    return { difference };
  });
}

/**
 * Reconcile against a statement balance. When the cleared ledger matches, every
 * cleared transaction up to the statement date is locked as "reconciled".
 */
export async function reconcileAccount(
  db: Database,
  userId: string,
  accountId: string,
  input: { statementBalance: number; statementDate: ISODate },
): Promise<{ balanced: boolean; difference: number; reconciledCount: number }> {
  return db.transaction(async (tx) => {
    await ownedAccount(tx, userId, accountId);
    const cleared = await accountBalanceAsOf(tx, userId, accountId, input.statementDate, true);
    const r = reconcile(cleared, input.statementBalance);
    if (!r.balanced) return { balanced: false, difference: r.difference, reconciledCount: 0 };
    const updated = await tx
      .update(transactions)
      .set({ status: "reconciled" })
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.userId, userId),
          eq(transactions.status, "cleared"),
          lte(transactions.date, input.statementDate),
        ),
      )
      .returning({ id: transactions.id });
    await tx.update(financialAccounts).set({ lastReconciledAt: new Date() }).where(eq(financialAccounts.id, accountId));
    await audit(tx, userId, "account", accountId, "reconcile", { statementDate: input.statementDate, count: updated.length });
    return { balanced: true, difference: 0, reconciledCount: updated.length };
  });
}

/**
 * Remove demo data created by the seed script: sample accounts, all their
 * transactions (both sides of transfers), and the debts, recurring rules and goals
 * attached to them. Real accounts are untouched.
 */
export async function removeSampleData(db: Database, userId: string): Promise<{ accounts: number; transactions: number }> {
  return db.transaction(async (tx) => {
    const sample = await tx
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(and(eq(financialAccounts.userId, userId), eq(financialAccounts.isSample, true)));
    const ids = sample.map((a) => a.id);
    if (!ids.length) return { accounts: 0, transactions: 0 };
    const groups = await tx
      .select({ g: transactions.transferGroupId })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), inArray(transactions.accountId, ids), isNotNull(transactions.transferGroupId)));
    const removed = await tx
      .delete(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          or(inArray(transactions.accountId, ids), groups.length ? inArray(transactions.transferGroupId, groups.map((g) => g.g!)) : undefined),
        ),
      )
      .returning({ id: transactions.id });
    await tx.delete(savingsGoals).where(and(eq(savingsGoals.userId, userId), inArray(savingsGoals.linkedAccountId, ids)));
    await tx.delete(financialAccounts).where(and(eq(financialAccounts.userId, userId), inArray(financialAccounts.id, ids)));
    await audit(tx, userId, "account", "sample", "remove_sample_data", { accounts: ids.length, transactions: removed.length });
    return { accounts: ids.length, transactions: removed.length };
  });
}
