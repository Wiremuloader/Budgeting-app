import { add, mulDiv, type Cents } from "./money";
import { addDays, diffDays, type ISODate } from "./dates";
import { occurrencesBetween, type RecurrenceRule } from "./recurrence";

/**
 * Cash-flow forecast for the user's spendable cash.
 *
 * balance(d) = startBalance
 *            + scheduled cash-flow events on or before d (income, bills, debt payments,
 *              planned savings moved out of the forecast accounts)
 *            − estimated variable spending per day × days elapsed
 *
 * Only movements that cross the boundary of the forecast account set change the
 * total: a transfer between two forecast accounts is excluded by the caller so it
 * cannot inflate or deflate the projection.
 *
 * Variable spending is estimated from history (spending that isn't already covered
 * by a recurring rule). Three scenarios scale it:
 *   optimistic   = 25th percentile of weekly spend
 *   expected     = mean weekly spend
 *   conservative = 75th percentile of weekly spend (at least the mean ×1.15)
 */

export interface ScheduledFlow {
  /** Positive = into forecast accounts, negative = out. */
  amount: Cents;
  label: string;
  source: "recurring" | "planned";
  rule?: RecurrenceRule;
  /** For one-off planned items. */
  date?: ISODate;
  /** Occurrences already matched to real transactions (don't count twice). */
  settledDates?: ISODate[];
}

export interface ForecastEvent {
  date: ISODate;
  amount: Cents;
  label: string;
  source: ScheduledFlow["source"];
}

export interface ForecastPoint {
  date: ISODate;
  optimistic: Cents;
  expected: Cents;
  conservative: Cents;
  events: ForecastEvent[];
}

export interface VariableSpendEstimate {
  dailyOptimistic: Cents;
  dailyExpected: Cents;
  dailyConservative: Cents;
  weeksOfHistory: number;
  sufficient: boolean;
}

export interface ForecastResult {
  start: ISODate;
  days: number;
  startBalance: Cents;
  points: ForecastPoint[];
  lowest: { date: ISODate; expected: Cents; conservative: Cents };
  endExpected: Cents;
  shortfall: { date: ISODate; scenario: "expected" | "conservative" } | null;
  variable: VariableSpendEstimate;
  assumptions: string[];
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

/**
 * Estimate daily variable spending from a list of (date, positive amount spent)
 * covering [historyFrom, historyTo].
 */
export function estimateVariableSpending(
  spends: { date: ISODate; amount: Cents }[],
  historyFrom: ISODate,
  historyTo: ISODate,
): VariableSpendEstimate {
  const totalDays = diffDays(historyFrom, historyTo) + 1;
  const weeks = Math.floor(totalDays / 7);
  if (weeks < 1) {
    return { dailyOptimistic: 0, dailyExpected: 0, dailyConservative: 0, weeksOfHistory: 0, sufficient: false };
  }
  const buckets = new Array<number>(weeks).fill(0);
  // Bucket from the most recent day backwards so partial weeks fall off the old end.
  for (const s of spends) {
    const back = diffDays(s.date, historyTo);
    if (back < 0 || back >= weeks * 7) continue;
    const w = weeks - 1 - Math.floor(back / 7);
    buckets[w] = add(buckets[w], s.amount);
  }
  const sorted = [...buckets].sort((a, b) => a - b);
  const mean = Math.round(buckets.reduce((a, b) => a + b, 0) / weeks);
  const p25 = percentile(sorted, 0.25);
  const p75 = Math.max(percentile(sorted, 0.75), mulDiv(mean, 115, 100));
  return {
    dailyOptimistic: Math.round(Math.min(p25, mean) / 7),
    dailyExpected: Math.round(mean / 7),
    dailyConservative: Math.round(p75 / 7),
    weeksOfHistory: weeks,
    sufficient: weeks >= 4,
  };
}

export function expandFlows(flows: ScheduledFlow[], from: ISODate, to: ISODate): ForecastEvent[] {
  const events: ForecastEvent[] = [];
  for (const f of flows) {
    if (f.rule) {
      const settled = new Set(f.settledDates ?? []);
      for (const d of occurrencesBetween(f.rule, from, to)) {
        if (!settled.has(d)) events.push({ date: d, amount: f.amount, label: f.label, source: f.source });
      }
    } else if (f.date && f.date >= from && f.date <= to) {
      events.push({ date: f.date, amount: f.amount, label: f.label, source: f.source });
    }
  }
  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
}

export interface ForecastInput {
  today: ISODate;
  days: number;
  startBalance: Cents;
  flows: ScheduledFlow[];
  variable: VariableSpendEstimate;
  /** Balance the user wants to stay above. */
  safetyThreshold?: Cents;
}

/**
 * Forecast from tomorrow for `days` days. Today's balance is taken as already
 * reflecting today's activity.
 */
export function forecastCashFlow(input: ForecastInput): ForecastResult {
  const start = input.today;
  const from = addDays(start, 1);
  const to = addDays(start, input.days);
  const events = expandFlows(input.flows, from, to);
  const byDate = new Map<ISODate, ForecastEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const threshold = input.safetyThreshold ?? 0;
  let scheduled = 0;
  const points: ForecastPoint[] = [];
  let lowest = { date: start, expected: input.startBalance, conservative: input.startBalance };
  let shortfall: ForecastResult["shortfall"] = null;

  for (let i = 1; i <= input.days; i++) {
    const date = addDays(start, i);
    const dayEvents = byDate.get(date) ?? [];
    for (const e of dayEvents) scheduled = add(scheduled, e.amount);
    const base = add(input.startBalance, scheduled);
    const p: ForecastPoint = {
      date,
      optimistic: add(base, -input.variable.dailyOptimistic * i),
      expected: add(base, -input.variable.dailyExpected * i),
      conservative: add(base, -input.variable.dailyConservative * i),
      events: dayEvents,
    };
    points.push(p);
    if (p.expected < lowest.expected) lowest = { date, expected: p.expected, conservative: p.conservative };
    if (!shortfall && p.expected < threshold) shortfall = { date, scenario: "expected" };
    else if (!shortfall && p.conservative < threshold) shortfall = { date, scenario: "conservative" };
  }

  const assumptions = [
    "Starts from the current balance of your spendable accounts, including pending transactions.",
    "Adds confirmed recurring income and bills on their scheduled dates; occurrences already matched to a real transaction are not counted again.",
    input.variable.sufficient
      ? `Estimates other day-to-day spending from your last ${input.variable.weeksOfHistory} weeks.`
      : `Only ${input.variable.weeksOfHistory} week(s) of history are available, so day-to-day spending estimates are rough.`,
    "Transfers between the included accounts are ignored because they don't change the total.",
    "This is an estimate, not a guarantee of available money.",
  ];

  return {
    start,
    days: input.days,
    startBalance: input.startBalance,
    points,
    lowest,
    endExpected: points.length ? points[points.length - 1].expected : input.startBalance,
    shortfall,
    variable: input.variable,
    assumptions,
  };
}
