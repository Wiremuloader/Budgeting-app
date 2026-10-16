import { sql } from "drizzle-orm";
import type { Queryable } from "../db";
import { budgetAllocations, recurringRules, savingsGoals, transactions } from "../db/schema";
import { accountTotals, listAccounts } from "./accounts";
import { getBudgetMonth } from "./budget";
import { buildForecast } from "./forecast";
import { listGoals } from "./goals";
import { buildInsights } from "./insights";
import { occurrences } from "./recurring";
import { categoryBreakdown, dailySeries, monthlySummaries, netWorthHistory } from "./reports";
import { linesFor } from "./reports";
import type { Preferences } from "../auth/session";
import { summarize } from "@/domain/ledger";
import {
  addDays,
  addMonthKey,
  diffDays,
  monthEnd,
  monthKey,
  monthRange,
  monthStart,
  parseDate,
  type DateRange,
  type ISODate,
  type MonthKey,
} from "@/domain/dates";
import { add, sum } from "@/domain/money";

export type OverviewPeriod = "month" | "last_month" | "3m" | "ytd" | "12m";

export function periodRange(p: OverviewPeriod, today: ISODate): DateRange & { label: string; months: MonthKey[] } {
  const m = monthKey(today);
  switch (p) {
    case "last_month": {
      const lm = addMonthKey(m, -1);
      return { from: monthStart(lm), to: monthEnd(lm), label: "Last month", months: [lm] };
    }
    case "3m":
      return { from: monthStart(addMonthKey(m, -2)), to: today, label: "Last 3 months", months: monthRange(addMonthKey(m, -2), m) };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "Year to date", months: monthRange(`${today.slice(0, 4)}-01`, m) };
    case "12m":
      return { from: monthStart(addMonthKey(m, -11)), to: today, label: "Last 12 months", months: monthRange(addMonthKey(m, -11), m) };
    default:
      return { from: monthStart(m), to: today, label: "This month", months: [m] };
  }
}

/** The same span of days in the preceding period, so month-to-date compares fairly. */
export function comparisonRange(r: DateRange, p: OverviewPeriod): DateRange {
  if (p === "month") {
    const prevMonth = addMonthKey(monthKey(r.from), -1);
    const day = Math.min(parseDate(r.to).day, parseDate(monthEnd(prevMonth)).day);
    return { from: monthStart(prevMonth), to: `${prevMonth}-${String(day).padStart(2, "0")}` };
  }
  const len = diffDays(r.from, r.to) + 1;
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

export async function onboardingChecklist(db: Queryable, userId: string, prefs: Preferences) {
  const [counts] = await db
    .select({
      txns: sql<number>`(select count(*)::int from ${transactions} where ${transactions.userId} = ${userId} and ${transactions.kind} = 'standard')`,
      allocs: sql<number>`(select count(*)::int from ${budgetAllocations} where ${budgetAllocations.userId} = ${userId})`,
      income: sql<number>`(select count(*)::int from ${recurringRules} where ${recurringRules.userId} = ${userId} and ${recurringRules.kind} = 'income')`,
      bills: sql<number>`(select count(*)::int from ${recurringRules} where ${recurringRules.userId} = ${userId} and ${recurringRules.kind} <> 'income')`,
      goals: sql<number>`(select count(*)::int from ${savingsGoals} where ${savingsGoals.userId} = ${userId})`,
    })
    .from(sql`(select 1) as one`);
  const accounts = await listAccounts(db, userId);
  const items = [
    { key: "account", label: "Add an account", done: accounts.length > 0, href: "/accounts?new=1" },
    { key: "transactions", label: "Add or import transactions", done: counts.txns > 0, href: "/transactions/import" },
    { key: "income", label: "Add your regular income", done: counts.income > 0, href: "/recurring?new=income" },
    { key: "bills", label: "Add your bills", done: counts.bills > 0, href: "/recurring?new=bill" },
    { key: "budget", label: "Set up your budget", done: counts.allocs > 0, href: "/budget" },
    { key: "goal", label: "Create a savings goal", done: counts.goals > 0, href: "/goals?new=1" },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, visible: !prefs.checklistDismissedAt && done < items.length };
}

export async function getOverview(db: Queryable, userId: string, prefs: Preferences, today: ISODate, period: OverviewPeriod) {
  const currency = prefs.currency;
  const range = periodRange(period, today);
  const compare = comparisonRange(range, period);
  const month = monthKey(today);
  const sixMonths = monthRange(addMonthKey(month, -5), month);
  const twelveMonths = monthRange(addMonthKey(month, -11), month);

  const [accounts, budget, forecast, goals, upcoming, periodLines, compareLines, trend, categories, netWorth, daily, prevDaily, checklist] =
    await Promise.all([
      listAccounts(db, userId),
      getBudgetMonth(db, userId, month, prefs, today),
      buildForecast(db, userId, today, 30, { currency, safetyBuffer: prefs.safetyBuffer, lowBalanceThreshold: prefs.lowBalanceThreshold }),
      listGoals(db, userId, today),
      occurrences(db, userId, addDays(today, -7), addDays(today, 30), today),
      linesFor(db, userId, range),
      linesFor(db, userId, compare),
      monthlySummaries(db, userId, period === "12m" || period === "ytd" ? twelveMonths : sixMonths),
      categoryBreakdown(db, userId, range),
      netWorthHistory(db, userId, twelveMonths, currency, today),
      dailySeries(db, userId, { from: monthStart(month), to: today }),
      dailySeries(db, userId, { from: monthStart(addMonthKey(month, -1)), to: monthEnd(addMonthKey(month, -1)) }),
      onboardingChecklist(db, userId, prefs),
    ]);

  const totals = accountTotals(accounts, currency);
  const summary = summarize(periodLines);
  const previous = summarize(compareLines);
  const insights = await buildInsights(db, userId, {
    today,
    currency,
    budget,
    forecast,
    occurrences: upcoming,
    goals,
    lowBalanceThreshold: prefs.lowBalanceThreshold,
  });

  const activeGoals = goals.filter((g) => g.status === "active" || g.status === "paused");
  const bills = upcoming.filter((o) => o.amount < 0 && o.date >= today && o.status !== "paid").slice(0, 8);
  const overdue = upcoming.filter((o) => o.status === "late" || o.status === "missed");
  const budgetTotal = sum(budget.categories.map((c) => add(c.assigned, c.carryIn)));

  return {
    period,
    range,
    compare,
    currency,
    accounts,
    totals,
    summary,
    previous,
    budget: {
      method: budget.method,
      readyToAssign: budget.readyToAssign,
      totalBudgeted: budgetTotal,
      totalSpent: budget.totalSpent,
      remaining: add(budgetTotal, -budget.totalSpent),
      overspentTotal: budget.overspentTotal,
      hasAllocations: budget.hasAllocations,
      categories: budget.categories
        .filter((c) => c.assigned > 0 || c.spent > 0)
        .map((c) => ({ id: c.id, name: c.name, budgeted: add(c.assigned, c.carryIn), spent: c.spent, projected: c.projected, status: c.status })),
    },
    forecast,
    goals: activeGoals,
    goalsSavedTotal: sum(activeGoals.map((g) => g.savedAmount)),
    bills,
    overdue,
    trend,
    categories,
    netWorth,
    daily,
    prevDaily,
    insights,
    checklist,
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;
