import { add, assertCents, mulDiv, sum, type Cents } from "./money";

/**
 * Debt payoff simulation.
 *
 * Model (stated to the user alongside every result):
 *  - Interest accrues monthly at APR ÷ 12 on the balance at the start of the month
 *    (rounded to the cent, half away from zero). Lenders that compound daily will differ slightly.
 *  - Payments are made once a month, after interest.
 *  - No new borrowing or fees during the projection.
 *  - The total monthly payment stays constant: when a debt is cleared, its minimum
 *    payment rolls onto the next target debt.
 *  - Rate changes are only applied where the user has entered them explicitly.
 */

export type Strategy = "avalanche" | "snowball" | "minimum";

export interface DebtInput {
  id: string;
  name: string;
  /** Amount owed, positive. */
  balance: Cents;
  /** Annual rate in basis points (19.95 % → 1 995). 0 for interest-free loans. */
  aprBps: number;
  minimumPayment: Cents;
  /** Optional future rate changes, month index counted from 1 = first projected month. */
  rateChanges?: { fromMonth: number; aprBps: number }[];
}

export interface DebtPayoff {
  id: string;
  name: string;
  payoffMonth: number | null; // 1-based month index, null if not paid off within the horizon
  interestPaid: Cents;
  totalPaid: Cents;
}

export interface PayoffResult {
  strategy: Strategy;
  months: number | null;
  totalInterest: Cents;
  totalPaid: Cents;
  monthlyPayment: Cents;
  order: string[];
  debts: DebtPayoff[];
  /** Total remaining balance at the end of each month (for charting). */
  balanceByMonth: Cents[];
  warnings: string[];
}

const MAX_MONTHS = 600;

function rateFor(d: DebtInput, month: number): number {
  let rate = d.aprBps;
  for (const c of [...(d.rateChanges ?? [])].sort((a, b) => a.fromMonth - b.fromMonth)) {
    if (month >= c.fromMonth) rate = c.aprBps;
  }
  return rate;
}

export function monthlyInterest(balance: Cents, aprBps: number): Cents {
  if (balance <= 0 || aprBps <= 0) return 0;
  return mulDiv(balance, aprBps, 120_000); // balance × (bps/10 000) ÷ 12
}

export function orderDebts(debts: DebtInput[], strategy: Strategy): DebtInput[] {
  const copy = [...debts];
  if (strategy === "avalanche") {
    copy.sort((a, b) => b.aprBps - a.aprBps || a.balance - b.balance || a.id.localeCompare(b.id));
  } else if (strategy === "snowball") {
    copy.sort((a, b) => a.balance - b.balance || b.aprBps - a.aprBps || a.id.localeCompare(b.id));
  }
  return copy;
}

export function simulatePayoff(debts: DebtInput[], strategy: Strategy, extraMonthly: Cents = 0): PayoffResult {
  assertCents(extraMonthly);
  const warnings: string[] = [];
  const active = debts.filter((d) => d.balance > 0);
  for (const d of active) {
    assertCents(d.balance);
    assertCents(d.minimumPayment);
    if (!Number.isInteger(d.aprBps) || d.aprBps < 0) throw new RangeError("APR must be a non-negative integer of basis points");
  }
  const ordered = orderDebts(active, strategy);
  const balances = new Map(ordered.map((d) => [d.id, d.balance]));
  const stats = new Map<string, DebtPayoff>(
    ordered.map((d) => [d.id, { id: d.id, name: d.name, payoffMonth: null, interestPaid: 0, totalPaid: 0 }]),
  );
  const monthlyPayment = add(sum(ordered.map((d) => d.minimumPayment)), strategy === "minimum" ? 0 : extraMonthly);
  const balanceByMonth: Cents[] = [];
  let month = 0;
  let totalInterest = 0;
  let totalPaid = 0;

  while ([...balances.values()].some((b) => b > 0) && month < MAX_MONTHS) {
    month += 1;
    // 1. interest
    for (const d of ordered) {
      const b = balances.get(d.id)!;
      if (b <= 0) continue;
      const i = monthlyInterest(b, rateFor(d, month));
      balances.set(d.id, add(b, i));
      stats.get(d.id)!.interestPaid = add(stats.get(d.id)!.interestPaid, i);
      totalInterest = add(totalInterest, i);
    }
    // 2. minimums
    let budget = monthlyPayment;
    for (const d of ordered) {
      const b = balances.get(d.id)!;
      if (b <= 0) continue;
      const pay = Math.min(b, d.minimumPayment, budget);
      balances.set(d.id, add(b, -pay));
      stats.get(d.id)!.totalPaid = add(stats.get(d.id)!.totalPaid, pay);
      budget = add(budget, -pay);
      totalPaid = add(totalPaid, pay);
    }
    // 3. surplus to targets in strategy order (minimum strategy keeps surplus unused)
    if (strategy !== "minimum") {
      for (const d of ordered) {
        if (budget <= 0) break;
        const b = balances.get(d.id)!;
        if (b <= 0) continue;
        const pay = Math.min(b, budget);
        balances.set(d.id, add(b, -pay));
        stats.get(d.id)!.totalPaid = add(stats.get(d.id)!.totalPaid, pay);
        budget = add(budget, -pay);
        totalPaid = add(totalPaid, pay);
      }
    }
    for (const d of ordered) {
      const s = stats.get(d.id)!;
      if (s.payoffMonth === null && balances.get(d.id)! <= 0) s.payoffMonth = month;
    }
    balanceByMonth.push(sum(balances.values()));
    // Stop early when balances are growing — payments don't cover interest.
    if (month >= 2 && balanceByMonth[month - 1] >= balanceByMonth[month - 2] && balanceByMonth[month - 1] > 0) {
      warnings.push("Payments do not cover the interest being charged, so the balance never decreases.");
      break;
    }
  }

  const remaining = [...balances.values()].some((b) => b > 0);
  if (remaining && !warnings.length) {
    warnings.push(`Not paid off within ${MAX_MONTHS / 12} years at this payment level.`);
  }
  for (const d of ordered) {
    if (d.minimumPayment <= 0) warnings.push(`${d.name} has no minimum payment entered.`);
  }
  return {
    strategy,
    months: remaining ? null : month,
    totalInterest,
    totalPaid,
    monthlyPayment,
    order: ordered.map((d) => d.id),
    debts: ordered.map((d) => stats.get(d.id)!),
    balanceByMonth,
    warnings,
  };
}

export interface StrategyComparison {
  minimum: PayoffResult;
  avalanche: PayoffResult;
  snowball: PayoffResult;
  /** Interest saved by the cheaper of avalanche/snowball versus minimum payments only. */
  interestSaved: Cents | null;
}

export function compareStrategies(debts: DebtInput[], extraMonthly: Cents): StrategyComparison {
  const minimum = simulatePayoff(debts, "minimum", 0);
  const avalanche = simulatePayoff(debts, "avalanche", extraMonthly);
  const snowball = simulatePayoff(debts, "snowball", extraMonthly);
  const best = Math.min(avalanche.totalInterest, snowball.totalInterest);
  return {
    minimum,
    avalanche,
    snowball,
    interestSaved: minimum.months === null ? null : add(minimum.totalInterest, -best),
  };
}

export const DEBT_ASSUMPTIONS = [
  "Interest is calculated monthly at the annual rate ÷ 12. Lenders that calculate daily interest will differ slightly.",
  "One payment per month, applied after that month's interest.",
  "No new purchases, fees, or borrowing during the projection.",
  "When a debt is paid off, its minimum payment is redirected to the next debt.",
  "Rates stay as entered unless you add a rate change.",
];
