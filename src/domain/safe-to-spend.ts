import { add, sum, type Cents } from "./money";
import { diffDays, type ISODate } from "./dates";
import type { ForecastEvent } from "./forecast";

/**
 * "Safe to spend" until the next expected payday.
 *
 *   safeToSpend = spendable balance (incl. pending)
 *               − confirmed bills & scheduled outflows due before the next payday
 *               − the user's safety buffer
 *
 * Expected income is never added before it arrives. If there is no recurring
 * income on file, the horizon falls back to the end of the current month and
 * the result says so.
 */

export interface SafeToSpendInput {
  today: ISODate;
  spendableBalance: Cents;
  /** Upcoming scheduled events (from forecast expansion), after today. */
  events: ForecastEvent[];
  /** Next expected income date, if any recurring income exists. */
  nextPayday: ISODate | null;
  fallbackHorizon: ISODate;
  safetyBuffer: Cents;
}

export interface SafeToSpend {
  amount: Cents;
  perDay: Cents | null;
  horizon: ISODate;
  horizonKind: "payday" | "month_end";
  daysUntilHorizon: number;
  committed: Cents;
  committedItems: ForecastEvent[];
  buffer: Cents;
  spendableBalance: Cents;
}

export function safeToSpend(input: SafeToSpendInput): SafeToSpend {
  const horizon = input.nextPayday ?? input.fallbackHorizon;
  const horizonKind = input.nextPayday ? "payday" : "month_end";
  // Bills due on payday itself are paid from the incoming pay, so stop the day before.
  const items = input.events.filter(
    (e) => e.amount < 0 && e.date > input.today && (horizonKind === "payday" ? e.date < horizon : e.date <= horizon),
  );
  const committed = -sum(items.map((e) => e.amount));
  const amount = add(input.spendableBalance, -committed, -input.safetyBuffer);
  const days = Math.max(diffDays(input.today, horizon), 1);
  return {
    amount,
    perDay: amount > 0 ? Math.floor(amount / days) : null,
    horizon,
    horizonKind,
    daysUntilHorizon: diffDays(input.today, horizon),
    committed,
    committedItems: items,
    buffer: input.safetyBuffer,
    spendableBalance: input.spendableBalance,
  };
}
