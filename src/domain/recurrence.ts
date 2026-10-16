import {
  addDays,
  addMonths,
  diffDays,
  parseDate,
  toDayNumber,
  type ISODate,
} from "./dates";

/**
 * Recurrence rules.
 *
 * Day/week based schedules step a fixed number of days from the anchor date.
 * Month/year based schedules are computed from the anchor each time (never by
 * repeatedly adding to the previous occurrence), so a rule anchored on the 31st
 * lands on the last day of short months and returns to the 31st afterwards.
 */

export type Frequency = "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly" | "custom";
export type IntervalUnit = "day" | "week" | "month" | "year";

export interface RecurrenceRule {
  frequency: Frequency;
  /** Only used when frequency is "custom". */
  interval?: number;
  unit?: IntervalUnit;
  anchorDate: ISODate;
  endDate?: ISODate | null;
}

interface Step {
  kind: "days" | "months";
  size: number;
}

export function stepOf(rule: RecurrenceRule): Step {
  switch (rule.frequency) {
    case "weekly":
      return { kind: "days", size: 7 };
    case "fortnightly":
      return { kind: "days", size: 14 };
    case "monthly":
      return { kind: "months", size: 1 };
    case "quarterly":
      return { kind: "months", size: 3 };
    case "yearly":
      return { kind: "months", size: 12 };
    case "custom": {
      const n = rule.interval ?? 1;
      if (!Number.isInteger(n) || n < 1 || n > 366) throw new RangeError("interval must be 1–366");
      switch (rule.unit ?? "month") {
        case "day":
          return { kind: "days", size: n };
        case "week":
          return { kind: "days", size: 7 * n };
        case "month":
          return { kind: "months", size: n };
        case "year":
          return { kind: "months", size: 12 * n };
      }
    }
  }
  throw new RangeError(`Unknown frequency ${rule.frequency as string}`);
}

function occurrenceAt(rule: RecurrenceRule, step: Step, k: number): ISODate {
  if (step.kind === "days") return addDays(rule.anchorDate, k * step.size);
  return addMonths(rule.anchorDate, k * step.size, parseDate(rule.anchorDate).day);
}

/** All occurrences in [from, to] (inclusive), honouring anchor and end date. */
export function occurrencesBetween(rule: RecurrenceRule, from: ISODate, to: ISODate, limit = 1000): ISODate[] {
  if (to < from) return [];
  const step = stepOf(rule);
  const end = rule.endDate && rule.endDate < to ? rule.endDate : to;
  const start = from > rule.anchorDate ? from : rule.anchorDate;
  if (end < start) return [];

  // Jump close to `start` instead of iterating from the anchor.
  let k: number;
  if (step.kind === "days") {
    k = Math.max(0, Math.floor(diffDays(rule.anchorDate, start) / step.size));
  } else {
    const a = parseDate(rule.anchorDate);
    const s = parseDate(start);
    const months = (s.year - a.year) * 12 + (s.month - a.month);
    k = Math.max(0, Math.floor(months / step.size) - 1);
  }

  const out: ISODate[] = [];
  for (;;) {
    const d = occurrenceAt(rule, step, k);
    if (d > end) break;
    if (d >= start) {
      out.push(d);
      if (out.length >= limit) break;
    }
    k += 1;
  }
  return out;
}

export function nextOccurrence(rule: RecurrenceRule, onOrAfter: ISODate): ISODate | null {
  // Look ahead far enough for the longest supported interval.
  const horizon = addDays(onOrAfter, 366 * 13);
  const [next] = occurrencesBetween(rule, onOrAfter, horizon, 1);
  return next ?? null;
}

export function previousOccurrence(rule: RecurrenceRule, onOrBefore: ISODate): ISODate | null {
  if (onOrBefore < rule.anchorDate) return null;
  const list = occurrencesBetween(rule, addDays(onOrBefore, -366 * 13), onOrBefore);
  return list.length ? list[list.length - 1] : null;
}

/** Average occurrences per (365.25-day) year, for annualising amounts. */
export function occurrencesPerYear(rule: RecurrenceRule): { numerator: number; denominator: number } {
  const step = stepOf(rule);
  if (step.kind === "months") return { numerator: 12, denominator: step.size };
  // 365.25 / size  →  1461 / (4 × size)
  return { numerator: 1461, denominator: 4 * step.size };
}

/** Typical gap in days, for display and pattern matching. */
export function approximateIntervalDays(rule: RecurrenceRule): number {
  const step = stepOf(rule);
  return step.kind === "days" ? step.size : Math.round(step.size * 30.44);
}

export function describeRule(rule: RecurrenceRule): string {
  switch (rule.frequency) {
    case "weekly":
      return "Weekly";
    case "fortnightly":
      return "Fortnightly";
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "yearly":
      return "Yearly";
    case "custom": {
      const n = rule.interval ?? 1;
      const unit = rule.unit ?? "month";
      return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
    }
  }
}

/** Matching window used to pair a scheduled occurrence with a real transaction. */
export function matchWindowDays(rule: RecurrenceRule): number {
  const days = approximateIntervalDays(rule);
  if (days <= 7) return 2;
  if (days <= 14) return 3;
  return 5;
}

export function isWithinWindow(scheduled: ISODate, actual: ISODate, windowDays: number): boolean {
  return Math.abs(toDayNumber(actual) - toDayNumber(scheduled)) <= windowDays;
}
