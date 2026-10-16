import { add, formatMoney, mulDiv, ratioBps, type Cents } from "./money";
import { diffDays, formatDisplayDate, type ISODate, type MonthKey } from "./dates";
import type { ForecastResult } from "./forecast";
import { goalScenarios, type GoalInput } from "./goals";

/**
 * Insights are small, explainable observations computed from real figures.
 * Each one carries the calculation that produced it (`reasoning`) and whether it
 * is a fact (from recorded transactions) or an estimate (a projection).
 * The `key` is stable for the same subject and period so dismissals stick.
 */

export type InsightSeverity = "info" | "warning" | "positive";

export interface Insight {
  key: string;
  type:
    | "category_above_average"
    | "projected_overspend"
    | "upcoming_bill"
    | "low_balance_forecast"
    | "goal_acceleration"
    | "large_transaction"
    | "uncategorised"
    | "income_missing";
  severity: InsightSeverity;
  title: string;
  body: string;
  reasoning: string[];
  basis: "fact" | "estimate";
  href?: string;
  priority: number; // higher first
}

const fmt = (c: Cents, currency: string) => formatMoney(c, currency, { compact: Math.abs(c) >= 100_00 });

export interface CategoryTrendInput {
  categoryId: string;
  name: string;
  month: MonthKey;
  /** Projected end-of-month spending (positive). */
  projected: Cents;
  spentSoFar: Cents;
  /** Average spending over the recent full months (positive). */
  average: Cents;
  /** How many full months the average covers. */
  historyMonths: number;
}

export function categoryAboveAverage(c: CategoryTrendInput, currency: string): Insight | null {
  if (c.historyMonths < 3) return null; // not enough history to call it a trend
  const avg = c.average;
  if (avg <= 0) return null;
  const diff = add(c.projected, -avg);
  const pct = ratioBps(diff, avg) ?? 0;
  if (pct < 2_000 || diff < 30_00) return null;
  return {
    key: `category_above_average:${c.categoryId}:${c.month}`,
    type: "category_above_average",
    severity: "warning",
    title: `${c.name} is running above your recent average`,
    body: `You're on track to spend about ${fmt(c.projected, currency)} on ${c.name.toLowerCase()} this month, around ${Math.round(pct / 100)}% more than your ${c.historyMonths}-month average of ${fmt(avg, currency)}.`,
    reasoning: [
      `Spent so far this month: ${formatMoney(c.spentSoFar, currency)}.`,
      `Projected month total: ${formatMoney(c.projected, currency)} (pace blended with history).`,
      `Average of the last ${c.historyMonths} full months: ${formatMoney(avg, currency)}.`,
    ],
    basis: "estimate",
    href: `/transactions?category=${c.categoryId}`,
    priority: 60 + Math.min(Math.round(pct / 1000), 20),
  };
}

export interface OverspendInput {
  categoryId: string;
  name: string;
  month: MonthKey;
  budgeted: Cents;
  spentSoFar: Cents;
  projected: Cents;
}

export function projectedOverspend(c: OverspendInput, currency: string): Insight | null {
  if (c.budgeted <= 0) return null;
  if (c.spentSoFar > c.budgeted) {
    return {
      key: `over_budget:${c.categoryId}:${c.month}`,
      type: "projected_overspend",
      severity: "warning",
      title: `${c.name} is over budget`,
      body: `You've spent ${fmt(c.spentSoFar, currency)} of ${fmt(c.budgeted, currency)} — ${fmt(add(c.spentSoFar, -c.budgeted), currency)} over.`,
      reasoning: [`Budgeted ${formatMoney(c.budgeted, currency)}; recorded spending ${formatMoney(c.spentSoFar, currency)}.`],
      basis: "fact",
      href: `/budget`,
      priority: 85,
    };
  }
  if (c.projected <= c.budgeted) return null;
  const over = add(c.projected, -c.budgeted);
  if (over < 10_00) return null;
  return {
    key: `projected_overspend:${c.categoryId}:${c.month}`,
    type: "projected_overspend",
    severity: "warning",
    title: `You may exceed your ${c.name.toLowerCase()} budget`,
    body: `At the current rate you'll spend about ${fmt(c.projected, currency)} against a budget of ${fmt(c.budgeted, currency)}.`,
    reasoning: [
      `Spent so far: ${formatMoney(c.spentSoFar, currency)}.`,
      `Projected month total: ${formatMoney(c.projected, currency)}.`,
      `Projected overspend: ${formatMoney(over, currency)}. This is an estimate and may change.`,
    ],
    basis: "estimate",
    href: `/budget`,
    priority: 75,
  };
}

export interface UpcomingBillInput {
  ruleId: string;
  name: string;
  date: ISODate;
  amount: Cents; // negative
}

export function upcomingBills(bills: UpcomingBillInput[], today: ISODate, currency: string, horizonDays = 7): Insight[] {
  return bills
    .filter((b) => b.amount < 0 && diffDays(today, b.date) >= 0 && diffDays(today, b.date) <= horizonDays)
    .map((b) => {
      const days = diffDays(today, b.date);
      const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `on ${formatDisplayDate(b.date, { weekday: true })}`;
      return {
        key: `upcoming_bill:${b.ruleId}:${b.date}`,
        type: "upcoming_bill" as const,
        severity: "info" as const,
        title: `${b.name} is due ${when}`,
        body: `Expected amount ${fmt(-b.amount, currency)}, based on your recurring schedule.`,
        reasoning: [`Scheduled from your confirmed recurring payment "${b.name}".`, "Not marked paid until a matching transaction is recorded."],
        basis: "estimate" as const,
        href: `/recurring`,
        priority: 50 - days,
      };
    });
}

export function lowBalanceForecast(f: ForecastResult, threshold: Cents, currency: string): Insight | null {
  if (!f.shortfall) return null;
  const point = f.points.find((p) => p.date === f.shortfall!.date)!;
  const value = f.shortfall.scenario === "expected" ? point.expected : point.conservative;
  return {
    key: `low_balance:${f.shortfall.date}:${f.shortfall.scenario}`,
    type: "low_balance_forecast",
    severity: "warning",
    title:
      f.shortfall.scenario === "expected"
        ? `Your balance may fall below ${fmt(threshold, currency)}`
        : `Your balance could dip below ${fmt(threshold, currency)} if spending runs high`,
    body: `Forecast for ${formatDisplayDate(f.shortfall.date, { weekday: true })}: about ${fmt(value, currency)} in your spendable accounts (${f.shortfall.scenario} scenario).`,
    reasoning: [
      `Starting balance ${formatMoney(f.startBalance, currency)}.`,
      `Includes scheduled income and bills, and estimated day-to-day spending of ${formatMoney(f.shortfall.scenario === "expected" ? f.variable.dailyExpected : f.variable.dailyConservative, currency)}/day.`,
      ...f.assumptions.slice(-1),
    ],
    basis: "estimate",
    href: `/reports?tab=forecast`,
    priority: f.shortfall.scenario === "expected" ? 90 : 70,
  };
}

export function goalAcceleration(
  goal: { id: string; name: string } & GoalInput,
  today: ISODate,
  currency: string,
): Insight | null {
  if (!goal.plannedContribution || goal.plannedContribution <= 0) return null;
  if (goal.savedAmount >= goal.targetAmount) return null;
  const bump = Math.max(Math.ceil(mulDiv(goal.plannedContribution, 25, 100) / 500) * 500, 5_00);
  const [s] = goalScenarios(goal, today, [add(goal.plannedContribution, bump)]);
  if (!s.deltaDays || s.deltaDays < 21) return null;
  const months = Math.round(s.deltaDays / 30.44);
  const span = months >= 2 ? `about ${months} months` : `about ${Math.round(s.deltaDays / 7)} weeks`;
  return {
    key: `goal_acceleration:${goal.id}:${today.slice(0, 7)}`,
    type: "goal_acceleration",
    severity: "positive",
    title: `Reach "${goal.name}" ${span} sooner`,
    body: `Adding ${fmt(bump, currency)} per ${goal.cadence === "weekly" ? "week" : goal.cadence === "fortnightly" ? "fortnight" : "month"} could bring your completion date forward by ${span}.`,
    reasoning: [
      `Remaining: ${formatMoney(add(goal.targetAmount, -goal.savedAmount), currency)}.`,
      `Current plan: ${formatMoney(goal.plannedContribution, currency)} per period.`,
      `With ${formatMoney(add(goal.plannedContribution, bump), currency)} per period, estimated completion ${s.completion ? formatDisplayDate(s.completion, { year: true }) : "—"}.`,
    ],
    basis: "estimate",
    href: `/goals`,
    priority: 40,
  };
}

export interface LargeTxnInput {
  id: string;
  date: ISODate;
  merchant: string;
  amount: Cents; // negative outflow
  categoryName: string | null;
  /** Median outflow (positive) in this category over the lookback window. */
  categoryMedian: Cents | null;
}

export function largeTransaction(t: LargeTxnInput, currency: string): Insight | null {
  const spent = -t.amount;
  if (spent < 100_00 || !t.categoryMedian || t.categoryMedian <= 0) return null;
  if (spent < t.categoryMedian * 3) return null;
  return {
    key: `large_transaction:${t.id}`,
    type: "large_transaction",
    severity: "info",
    title: `Larger than usual: ${t.merchant}`,
    body: `${fmt(spent, currency)} on ${formatDisplayDate(t.date)} is about ${Math.round(spent / t.categoryMedian)}× your typical ${t.categoryName?.toLowerCase() ?? "purchase"}.`,
    reasoning: [`Typical (median) ${t.categoryName ?? "transaction"} amount over the last 90 days: ${formatMoney(t.categoryMedian, currency)}.`],
    basis: "fact",
    href: `/transactions?q=${encodeURIComponent(t.merchant)}`,
    priority: 45,
  };
}

export function uncategorised(count: number, total: Cents, month: MonthKey, currency: string): Insight | null {
  if (count === 0) return null;
  return {
    key: `uncategorised:${month}:${count}`,
    type: "uncategorised",
    severity: "info",
    title: `${count} transaction${count === 1 ? "" : "s"} need a category`,
    body: `${fmt(total, currency)} isn't assigned to a category yet, so budget and report figures are incomplete.`,
    reasoning: ["Uncategorised outflows are counted in total spending but not in any category."],
    basis: "fact",
    href: `/transactions?category=none`,
    priority: 55,
  };
}

export function incomeMissing(ruleId: string, name: string, expected: ISODate, amount: Cents, today: ISODate, currency: string): Insight | null {
  const late = diffDays(expected, today);
  if (late < 2) return null;
  return {
    key: `income_missing:${ruleId}:${expected}`,
    type: "income_missing",
    severity: "warning",
    title: `${name} hasn't arrived yet`,
    body: `Expected ${fmt(amount, currency)} on ${formatDisplayDate(expected, { weekday: true })} — ${late} days ago. No matching deposit has been recorded.`,
    reasoning: ["Matched against deposits within a few days of the scheduled date.", "If it arrived, record or import the transaction and link it."],
    basis: "fact",
    href: `/recurring`,
    priority: 80,
  };
}

export function rankInsights(list: (Insight | null)[], dismissed: Set<string>, limit = 6): Insight[] {
  return list
    .filter((i): i is Insight => i !== null && !dismissed.has(i.key))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}
