import { asc, eq } from "drizzle-orm";
import type { Queryable } from "../db";
import * as s from "../db/schema";
import { toCsv } from "@/domain/csv";
import { toDecimalString } from "@/domain/money";
import { listTransactions, type TransactionFilters, type TransactionListItem } from "./transactions";
import type { CategoryBreakdownRow, MonthSummary } from "./reports";

/**
 * Transaction CSV export (format documented in docs/CSV_FORMATS.md). One row per
 * transaction; split transactions list their parts in the "Splits" column and also
 * emit one row per part when `expandSplits` is set, so spreadsheet sums by category stay exact.
 */
export async function exportTransactionsCsv(db: Queryable, userId: string, filters: TransactionFilters, opts: { expandSplits?: boolean } = {}): Promise<string> {
  const all: TransactionListItem[] = [];
  for (let page = 1; ; page++) {
    const res = await listTransactions(db, userId, { ...filters, page, pageSize: 200, sort: "date_asc" });
    all.push(...res.items);
    if (page >= res.pages) break;
  }
  type Row = TransactionListItem & { lineAmount: number; lineCategory: string | null; part: string };
  const rows: Row[] = [];
  for (const t of all) {
    if (opts.expandSplits && t.splits.length) {
      t.splits.forEach((sp, i) => rows.push({ ...t, lineAmount: sp.amount, lineCategory: sp.categoryName, part: `${i + 1}/${t.splits.length}` }));
    } else rows.push({ ...t, lineAmount: t.amount, lineCategory: t.categoryName, part: "" });
  }
  return toCsv(rows, [
    { header: "Date", value: (r) => r.date },
    { header: "Time", value: (r) => r.time },
    { header: "Account", value: (r) => r.accountName },
    { header: "Payee", value: (r) => r.merchant },
    { header: "Description", value: (r) => r.description },
    { header: "Category", value: (r) => (r.kind === "transfer" ? `Transfer${r.transferCounterpart ? ` (${r.transferCounterpart.accountName})` : ""}` : r.kind === "adjustment" ? "Balance adjustment" : (r.lineCategory ?? (r.splits.length ? "Split" : ""))) },
    { header: "Amount", value: (r) => toDecimalString(r.lineAmount, r.currency), numeric: true },
    { header: "Currency", value: (r) => r.currency },
    { header: "Type", value: (r) => r.kind },
    { header: "Status", value: (r) => r.status },
    { header: "Split part", value: (r) => r.part },
    { header: "Splits", value: (r) => (!opts.expandSplits && r.splits.length ? r.splits.map((sp) => `${sp.categoryName}: ${toDecimalString(sp.amount, r.currency)}`).join("; ") : "") },
    { header: "Tags", value: (r) => r.tags.join(" ") },
    { header: "Notes", value: (r) => r.notes },
    { header: "Reviewed", value: (r) => (r.reviewed ? "yes" : "no") },
    { header: "Id", value: (r) => r.id },
  ]);
}

export function summaryCsv(months: MonthSummary[], categories: CategoryBreakdownRow[], currency: string): string {
  const monthPart = toCsv(months, [
    { header: "Month", value: (m) => m.month },
    { header: "Income", value: (m) => toDecimalString(m.income, currency), numeric: true },
    { header: "Spending", value: (m) => toDecimalString(m.spending, currency), numeric: true },
    { header: "Net", value: (m) => toDecimalString(m.net, currency), numeric: true },
    { header: "Savings rate %", value: (m) => (m.savingsRateBps === null ? "" : (m.savingsRateBps / 100).toFixed(2)), numeric: true },
    { header: "Refunds", value: (m) => toDecimalString(m.refunds, currency), numeric: true },
    { header: "Uncategorised outflows", value: (m) => toDecimalString(m.uncategorisedOutflows, currency), numeric: true },
  ]);
  const catPart = toCsv(categories, [
    { header: "Category", value: (c) => c.name },
    { header: "Spending", value: (c) => toDecimalString(c.amount, currency), numeric: true },
    { header: "Previous period", value: (c) => toDecimalString(c.previous, currency), numeric: true },
    { header: "Change", value: (c) => toDecimalString(c.change, currency), numeric: true },
    { header: "Share %", value: (c) => (c.shareBps === null ? "" : (c.shareBps / 100).toFixed(2)), numeric: true },
  ]);
  return `${monthPart}\r\n${catPart}`;
}

/**
 * Full personal data export (JSON). Includes everything Ledger stores about the user's
 * finances. Auth secrets (password hashes, TOTP secrets, session tokens) are excluded.
 */
export async function exportAllData(db: Queryable, userId: string) {
  const [user] = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, createdAt: s.users.createdAt }).from(s.users).where(eq(s.users.id, userId));
  const by = <T extends { userId: unknown }>(t: T) => eq(t.userId as never, userId);
  const [preferences, accounts, categories, txns, splits, rules, goals, contributions, debts, debtPayments, budgets, allocations, notifications, imports, auditLog, rules2] =
    await Promise.all([
      db.select().from(s.userPreferences).where(by(s.userPreferences)),
      db.select().from(s.financialAccounts).where(by(s.financialAccounts)),
      db.select().from(s.categories).where(by(s.categories)),
      db.select().from(s.transactions).where(by(s.transactions)).orderBy(asc(s.transactions.date)),
      db.select().from(s.transactionSplits).where(by(s.transactionSplits)),
      db.select().from(s.recurringRules).where(by(s.recurringRules)),
      db.select().from(s.savingsGoals).where(by(s.savingsGoals)),
      db.select().from(s.goalContributions).where(by(s.goalContributions)),
      db.select().from(s.debts).where(by(s.debts)),
      db.select().from(s.debtPayments).where(by(s.debtPayments)),
      db.select().from(s.budgetPeriods).where(by(s.budgetPeriods)),
      db.select().from(s.budgetAllocations).where(by(s.budgetAllocations)),
      db.select().from(s.notifications).where(by(s.notifications)),
      db.select().from(s.importBatches).where(by(s.importBatches)),
      db.select().from(s.auditEvents).where(by(s.auditEvents)).orderBy(asc(s.auditEvents.createdAt)),
      db.select().from(s.merchantRules).where(by(s.merchantRules)),
    ]);
  const connections = await db
    .select({ id: s.bankConnections.id, provider: s.bankConnections.provider, displayName: s.bankConnections.displayName, status: s.bankConnections.status, createdAt: s.bankConnections.createdAt })
    .from(s.bankConnections)
    .where(eq(s.bankConnections.userId, userId));
  return {
    format: "ledger-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: "Money values are integers in minor units (cents). Dates are calendar dates (YYYY-MM-DD).",
    user,
    preferences,
    accounts,
    categories,
    transactions: txns,
    transactionSplits: splits,
    merchantRules: rules2,
    recurringRules: rules,
    savingsGoals: goals,
    goalContributions: contributions,
    debts,
    debtPayments,
    budgetPeriods: budgets,
    budgetAllocations: allocations,
    notifications,
    importBatches: imports,
    bankConnections: connections,
    auditEvents: auditLog,
  };
}
