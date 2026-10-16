import { mulDiv, type Cents } from "./money";
import { addDays, diffDays, type ISODate } from "./dates";
import type { Frequency } from "./recurrence";

/**
 * Recurring-pattern detection from transaction history. Results are SUGGESTIONS:
 * nothing is treated as a subscription or bill until the user confirms it.
 */

export interface PatternTxn {
  id: string;
  date: ISODate;
  amount: Cents; // negative = outflow
  merchantKey: string;
  merchantName: string;
  categoryId: string | null;
  accountId: string;
}

export interface DetectedPattern {
  merchantKey: string;
  merchantName: string;
  frequency: Frequency;
  intervalDays: number;
  /** Most recent amount (signed). */
  amount: Cents;
  /** Median absolute amount. */
  typicalAmount: Cents;
  occurrences: number;
  lastDate: ISODate;
  nextExpected: ISODate;
  annualCost: Cents;
  priceChange: { from: Cents; to: Cents; date: ISODate } | null;
  confidence: "high" | "medium";
  transactionIds: string[];
  categoryId: string | null;
  accountId: string;
  direction: "outflow" | "inflow";
}

const CANDIDATES: { frequency: Frequency; days: number; tolerance: number; perYear: [number, number] }[] = [
  { frequency: "weekly", days: 7, tolerance: 1, perYear: [52, 1] },
  { frequency: "fortnightly", days: 14, tolerance: 2, perYear: [26, 1] },
  { frequency: "monthly", days: 30, tolerance: 3, perYear: [12, 1] },
  { frequency: "quarterly", days: 91, tolerance: 6, perYear: [4, 1] },
  { frequency: "yearly", days: 365, tolerance: 10, perYear: [1, 1] },
];

function medianInt(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function detectRecurring(txns: PatternTxn[], today: ISODate, minOccurrences = 3): DetectedPattern[] {
  const groups = new Map<string, PatternTxn[]>();
  for (const t of txns) {
    if (t.amount === 0) continue;
    const k = `${t.merchantKey}|${t.amount < 0 ? "out" : "in"}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const out: DetectedPattern[] = [];
  for (const list of groups.values()) {
    if (list.length < minOccurrences) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) gaps.push(diffDays(list[i - 1].date, list[i].date));
    const medianGap = medianInt(gaps);
    const match = CANDIDATES.find((c) => Math.abs(medianGap - c.days) <= c.tolerance);
    if (!match) continue;
    const regular = gaps.filter((g) => Math.abs(g - match.days) <= match.tolerance * 2).length;
    if (regular / gaps.length < 0.75) continue;

    const absAmounts = list.map((t) => Math.abs(t.amount));
    const typical = medianInt(absAmounts);
    // Amounts must be reasonably stable (within 25 % of typical) to count as a subscription/bill.
    const stable = absAmounts.filter((a) => Math.abs(a - typical) <= mulDiv(typical, 25, 100)).length;
    if (stable / absAmounts.length < 0.75) continue;

    const last = list[list.length - 1];
    const lastDate = last.date;
    // A pattern that stopped more than two intervals ago is probably cancelled.
    if (diffDays(lastDate, today) > match.days * 2 + match.tolerance) continue;

    let priceChange: DetectedPattern["priceChange"] = null;
    for (let i = list.length - 1; i > 0; i--) {
      if (list[i].amount !== list[i - 1].amount) {
        if (i === list.length - 1) priceChange = { from: list[i - 1].amount, to: list[i].amount, date: list[i].date };
        break;
      }
    }
    const signedTypical = last.amount < 0 ? -typical : typical;
    out.push({
      merchantKey: last.merchantKey,
      merchantName: last.merchantName,
      frequency: match.frequency,
      intervalDays: match.days,
      amount: last.amount,
      typicalAmount: typical,
      occurrences: list.length,
      lastDate,
      // Approximate for month-based patterns; a confirmed rule uses calendar months.
      nextExpected: addDays(lastDate, match.days),
      annualCost: mulDiv(Math.abs(signedTypical), match.perYear[0], match.perYear[1]),
      priceChange,
      confidence: list.length >= 4 && regular === gaps.length ? "high" : "medium",
      transactionIds: list.map((t) => t.id),
      categoryId: last.categoryId,
      accountId: last.accountId,
      direction: last.amount < 0 ? "outflow" : "inflow",
    });
  }
  return out.sort((a, b) => b.annualCost - a.annualCost);
}

/** Annualised cost of a recurring amount for a frequency. */
export function annualise(amount: Cents, frequency: Frequency, intervalDays?: number): Cents {
  switch (frequency) {
    case "weekly":
      return mulDiv(amount, 52, 1);
    case "fortnightly":
      return mulDiv(amount, 26, 1);
    case "monthly":
      return mulDiv(amount, 12, 1);
    case "quarterly":
      return mulDiv(amount, 4, 1);
    case "yearly":
      return amount;
    case "custom":
      return intervalDays ? mulDiv(amount, 365, intervalDays) : amount;
  }
}

/** Two active subscriptions to the same merchant group look like a duplicate. */
export function possibleDuplicateSubscriptions(subs: { id: string; merchantKey: string }[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < subs.length; i++) {
    for (let j = i + 1; j < subs.length; j++) {
      const a = subs[i].merchantKey.split(" ")[0];
      const b = subs[j].merchantKey.split(" ")[0];
      if (a && a === b) pairs.push([subs[i].id, subs[j].id]);
    }
  }
  return pairs;
}
