import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { Queryable } from "../db";
import { budgetAllocations, budgetPeriods, categories, financialAccounts, transactions } from "../db/schema";
import { toCents } from "./common";
import { ledgerLines, type LedgerLineWithMeta } from "./transactions";
import { summarize, spendingByCategory, isLiability, type AccountType, type PeriodSummary } from "@/domain/ledger";
import { add, ratioBps, sum } from "@/domain/money";
import {
  addDays,
  daysInclusive,
  monthEnd,
  monthKey,
  monthRange,
  monthStart,
  previousRange,
  type DateRange,
  type ISODate,
  type MonthKey,
} from "@/domain/dates";

/**
 * Metric definitions (also shown in the UI — see docs/FINANCIAL_RULES.md §Metrics):
 *  Income        Inflows in income categories, net of corrections. Excludes transfers,
 *                balance adjustments and uncategorised inflows.
 *  Spending      Outflows in expense categories minus refunds, plus uncategorised outflows.
 *                Excludes transfers (incl. credit-card payments and loan repayments) and adjustments.
 *  Net           Income − Spending.
 *  Savings rate  Net ÷ Income. Money moved to savings or used to repay debt principal counts as
 *                saved (it's a transfer, not spending). Interest and fees are spending.
 *  Net worth     Assets − liabilities across accounts marked "include in net worth", in your
 *                main currency. Other currencies are listed separately, never converted.
 */

export interface ReportFilters {
  accountIds?: string[];
  categoryIds?: string[];
}

export interface MonthSummary extends PeriodSummary {
  month: MonthKey;
  transactionCount: number;
}

export async function linesFor(db: Queryable, userId: string, range: DateRange, f: ReportFilters = {}): Promise<LedgerLineWithMeta[]> {
  return ledgerLines(db, userId, range, { accountIds: f.accountIds, categoryIds: f.categoryIds, kinds: ["standard"] });
}

export async function monthlySummaries(db: Queryable, userId: string, months: MonthKey[], f: ReportFilters = {}): Promise<MonthSummary[]> {
  if (!months.length) return [];
  const lines = await linesFor(db, userId, { from: monthStart(months[0]), to: monthEnd(months[months.length - 1]) }, f);
  return months.map((m) => {
    const ml = lines.filter((l) => monthKey(l.date) === m);
    return { month: m, ...summarize(ml), transactionCount: new Set(ml.map((l) => l.transactionId)).size };
  });
}

export interface CategoryBreakdownRow {
  categoryId: string | null;
  name: string;
  icon: string | null;
  amount: number;
  previous: number;
  change: number;
  shareBps: number | null;
}

export async function categoryBreakdown(db: Queryable, userId: string, range: DateRange, f: ReportFilters = {}): Promise<CategoryBreakdownRow[]> {
  const prev = previousRange(range);
  const [cur, before, cats] = await Promise.all([
    linesFor(db, userId, range, f),
    linesFor(db, userId, prev, f),
    db.select({ id: categories.id, name: categories.name, icon: categories.icon }).from(categories).where(eq(categories.userId, userId)),
  ]);
  const a = spendingByCategory(cur);
  const b = spendingByCategory(before);
  const total = sum([...a.values()].filter((v) => v > 0));
  const keys = new Set([...a.keys(), ...b.keys()]);
  return [...keys]
    .map((k) => {
      const c = cats.find((x) => x.id === k);
      const amount = a.get(k) ?? 0;
      const previous = b.get(k) ?? 0;
      return { categoryId: k, name: c?.name ?? "Uncategorised", icon: c?.icon ?? null, amount, previous, change: add(amount, -previous), shareBps: amount > 0 ? ratioBps(amount, total) : null };
    })
    .filter((r) => r.amount !== 0 || r.previous !== 0)
    .sort((x, y) => y.amount - x.amount);
}

export interface MerchantRow {
  merchantKey: string;
  merchant: string;
  amount: number;
  count: number;
  average: number;
}

export async function merchantBreakdown(db: Queryable, userId: string, range: DateRange, f: ReportFilters = {}, limit = 15): Promise<MerchantRow[]> {
  const lines = (await linesFor(db, userId, range, f)).filter((l) => l.categoryGroup !== "income");
  const m = new Map<string, { merchant: string; amount: number; ids: Set<string> }>();
  for (const l of lines) {
    if (l.categoryGroup === null && l.amount > 0) continue;
    const e = m.get(l.merchantKey) ?? { merchant: l.merchant, amount: 0, ids: new Set<string>() };
    e.amount = add(e.amount, -l.amount);
    e.ids.add(l.transactionId);
    m.set(l.merchantKey, e);
  }
  return [...m.entries()]
    .map(([k, v]) => ({ merchantKey: k, merchant: v.merchant, amount: v.amount, count: v.ids.size, average: Math.round(v.amount / v.ids.size) }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export interface NetWorthPoint {
  month: MonthKey;
  date: ISODate;
  assets: number;
  liabilities: number;
  netWorth: number;
  cash: number;
  debt: number;
}

/** Month-end balances, computed from the transaction ledger (opening balances included). */
export async function netWorthHistory(db: Queryable, userId: string, allMonths: MonthKey[], currency: string, today: ISODate): Promise<NetWorthPoint[]> {
  // Don't invent history: start at the month of the earliest recorded transaction.
  const [firstRow] = await db.select({ d: sql<string | null>`min(${transactions.date})` }).from(transactions).where(eq(transactions.userId, userId));
  const months = firstRow?.d ? allMonths.filter((m) => m >= monthKey(firstRow.d!)) : [];
  if (!months.length) return [];
  const accounts = await db
    .select({ id: financialAccounts.id, type: financialAccounts.type, currency: financialAccounts.currency, includeInNetWorth: financialAccounts.includeInNetWorth })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.userId, userId), eq(financialAccounts.currency, currency)));
  const first = monthStart(months[0]);
  const [base, monthly] = await Promise.all([
    db
      .select({ accountId: transactions.accountId, total: sql<string>`sum(${transactions.amount})` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), lt(transactions.date, first)))
      .groupBy(transactions.accountId),
    db
      .select({
        accountId: transactions.accountId,
        month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
        total: sql<string>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), gte(transactions.date, first), lte(transactions.date, monthEnd(months[months.length - 1]))))
      .groupBy(transactions.accountId, sql`to_char(${transactions.date}, 'YYYY-MM')`),
  ]);
  const running = new Map<string, number>(base.map((b) => [b.accountId, toCents(b.total)]));
  const points: NetWorthPoint[] = [];
  for (const m of months) {
    for (const row of monthly.filter((r) => r.month === m)) running.set(row.accountId, add(running.get(row.accountId) ?? 0, toCents(row.total)));
    let assets = 0;
    let liabilities = 0;
    let cash = 0;
    let debt = 0;
    for (const a of accounts) {
      const bal = running.get(a.id) ?? 0;
      if (["checking", "savings", "cash"].includes(a.type)) cash = add(cash, bal);
      if (isLiability(a.type as AccountType) && bal < 0) debt = add(debt, -bal);
      if (!a.includeInNetWorth) continue;
      if (bal >= 0) assets = add(assets, bal);
      else liabilities = add(liabilities, -bal);
    }
    const end = monthEnd(m);
    points.push({ month: m, date: end > today ? today : end, assets, liabilities, netWorth: add(assets, -liabilities), cash, debt });
  }
  return points;
}

export interface BudgetPerformanceRow {
  month: MonthKey;
  assigned: number;
  spent: number;
  difference: number;
}

export async function budgetPerformance(db: Queryable, userId: string, months: MonthKey[]): Promise<BudgetPerformanceRow[]> {
  if (!months.length) return [];
  const [allocs, lines] = await Promise.all([
    db
      .select({ month: budgetPeriods.month, total: sql<string>`sum(${budgetAllocations.assigned})` })
      .from(budgetAllocations)
      .innerJoin(budgetPeriods, eq(budgetPeriods.id, budgetAllocations.periodId))
      .where(and(eq(budgetAllocations.userId, userId), gte(budgetPeriods.month, months[0]), lte(budgetPeriods.month, months[months.length - 1])))
      .groupBy(budgetPeriods.month),
    ledgerLines(db, userId, { from: monthStart(months[0]), to: monthEnd(months[months.length - 1]) }, { includeCategorisedTransfers: true }),
  ]);
  return months.map((m) => {
    const assigned = toCents(allocs.find((a) => a.month === m)?.total);
    const spent = -sum(
      lines
        .filter((l) => monthKey(l.date) === m && l.categoryGroup === "expense" && (l.kind === "standard" || (l.kind === "transfer" && l.categoryId)))
        .map((l) => l.amount),
    );
    return { month: m, assigned, spent, difference: add(assigned, -spent) };
  });
}

export interface DailyPoint {
  date: ISODate;
  income: number;
  spending: number;
  net: number;
  cumulativeSpending: number;
}

export async function dailySeries(db: Queryable, userId: string, range: DateRange, f: ReportFilters = {}): Promise<DailyPoint[]> {
  const lines = await linesFor(db, userId, range, f);
  const out: DailyPoint[] = [];
  let cumulative = 0;
  const days = daysInclusive(range.from, range.to);
  for (let i = 0; i < days; i++) {
    const d = addDays(range.from, i);
    const s = summarize(lines.filter((l) => l.date === d));
    cumulative = add(cumulative, s.spending);
    out.push({ date: d, income: s.income, spending: s.spending, net: s.net, cumulativeSpending: cumulative });
  }
  return out;
}

export interface DataCoverage {
  firstDate: ISODate | null;
  lastDate: ISODate | null;
  months: number;
  sufficientForTrends: boolean;
}

export async function dataCoverage(db: Queryable, userId: string): Promise<DataCoverage> {
  const [r] = await db
    .select({ first: sql<string | null>`min(${transactions.date})`, last: sql<string | null>`max(${transactions.date})` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.kind, "standard")));
  if (!r?.first || !r.last) return { firstDate: null, lastDate: null, months: 0, sufficientForTrends: false };
  const months = monthRange(monthKey(r.first), monthKey(r.last)).length;
  return { firstDate: r.first, lastDate: r.last, months, sufficientForTrends: months >= 3 };
}
