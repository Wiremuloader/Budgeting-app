import { add, assertCents, divideCeil, ratioBps, type Cents } from "./money";
import { addDays, addMonths, diffDays, type ISODate } from "./dates";

/**
 * Savings goals.
 *
 * Rule: a goal's saved amount is the sum of its contribution records (positive
 * contributions, negative withdrawals). Contributions are *earmarks* — they record
 * that part of an account's balance is set aside; they never move money and are
 * never added to account balances or net worth a second time. If a goal is linked
 * to an account, the sum of earmarks on that account should not exceed its balance;
 * `earmarkWarnings` reports where it does.
 */

export type ContributionCadence = "weekly" | "fortnightly" | "monthly";

export interface GoalInput {
  targetAmount: Cents;
  savedAmount: Cents;
  targetDate?: ISODate | null;
  /** Planned contribution per cadence period. */
  plannedContribution?: Cents | null;
  cadence?: ContributionCadence;
}

export interface GoalProgress {
  remaining: Cents;
  progressBps: number;
  complete: boolean;
  /** Contribution per cadence period needed to hit the target date. */
  requiredPerPeriod: Cents | null;
  periodsUntilTarget: number | null;
  /** Estimated completion with the planned contribution. */
  estimatedCompletion: ISODate | null;
  onTrack: boolean | null;
  status: "complete" | "on_track" | "behind" | "no_target_date" | "no_plan" | "overdue";
}

export function cadenceDays(c: ContributionCadence): number {
  return c === "weekly" ? 7 : c === "fortnightly" ? 14 : 30;
}

/** Number of whole contribution periods between today (exclusive) and the target date (inclusive). */
export function periodsBetween(today: ISODate, target: ISODate, cadence: ContributionCadence): number {
  if (target <= today) return 0;
  if (cadence === "monthly") {
    let n = 0;
    while (addMonths(today, n + 1) <= target) n += 1;
    return Math.max(n, 1);
  }
  return Math.max(Math.floor(diffDays(today, target) / cadenceDays(cadence)), 1);
}

export function addPeriods(start: ISODate, n: number, cadence: ContributionCadence): ISODate {
  return cadence === "monthly" ? addMonths(start, n) : addDays(start, n * cadenceDays(cadence));
}

export function goalProgress(g: GoalInput, today: ISODate): GoalProgress {
  assertCents(g.targetAmount);
  assertCents(g.savedAmount);
  const cadence = g.cadence ?? "monthly";
  const remaining = Math.max(add(g.targetAmount, -g.savedAmount), 0);
  const progressBps = Math.min(Math.max(ratioBps(g.savedAmount, g.targetAmount) ?? 0, 0), 10_000);
  const complete = g.targetAmount > 0 && g.savedAmount >= g.targetAmount;

  let requiredPerPeriod: Cents | null = null;
  let periodsUntilTarget: number | null = null;
  if (g.targetDate && !complete) {
    periodsUntilTarget = periodsBetween(today, g.targetDate, cadence);
    requiredPerPeriod = periodsUntilTarget > 0 ? divideCeil(remaining, periodsUntilTarget) : remaining;
  }

  let estimatedCompletion: ISODate | null = null;
  if (complete) estimatedCompletion = today;
  else if (g.plannedContribution && g.plannedContribution > 0) {
    const n = Math.ceil(remaining / g.plannedContribution);
    estimatedCompletion = addPeriods(today, n, cadence);
  }

  let status: GoalProgress["status"];
  let onTrack: boolean | null = null;
  if (complete) status = "complete";
  else if (g.targetDate && g.targetDate < today) status = "overdue";
  else if (!g.targetDate) status = g.plannedContribution ? "no_target_date" : "no_plan";
  else if (!estimatedCompletion) status = "no_plan";
  else {
    onTrack = estimatedCompletion <= g.targetDate;
    status = onTrack ? "on_track" : "behind";
  }
  if (complete) onTrack = true;

  return { remaining, progressBps, complete, requiredPerPeriod, periodsUntilTarget, estimatedCompletion, onTrack, status };
}

export interface GoalScenario {
  contribution: Cents;
  completion: ISODate | null;
  periods: number | null;
  /** Days earlier (+) or later (−) than the baseline completion. */
  deltaDays: number | null;
}

/** Compare completion dates for alternative contribution amounts. */
export function goalScenarios(
  g: GoalInput,
  today: ISODate,
  contributions: Cents[],
): GoalScenario[] {
  const cadence = g.cadence ?? "monthly";
  const remaining = Math.max(add(g.targetAmount, -g.savedAmount), 0);
  const baseline = goalProgress(g, today).estimatedCompletion;
  return contributions.map((c) => {
    if (c <= 0) return { contribution: c, completion: null, periods: null, deltaDays: null };
    const periods = Math.ceil(remaining / c);
    const completion = addPeriods(today, periods, cadence);
    return {
      contribution: c,
      completion,
      periods,
      deltaDays: baseline ? diffDays(completion, baseline) : null,
    };
  });
}

export interface EarmarkCheck {
  accountId: string;
  accountBalance: Cents;
  earmarked: Cents;
  overAllocated: Cents;
}

export function earmarkWarnings(
  accounts: { id: string; balance: Cents }[],
  goals: { linkedAccountId: string | null; savedAmount: Cents; archived?: boolean }[],
): EarmarkCheck[] {
  const byAccount = new Map<string, Cents>();
  for (const g of goals) {
    if (!g.linkedAccountId || g.archived) continue;
    byAccount.set(g.linkedAccountId, add(byAccount.get(g.linkedAccountId) ?? 0, g.savedAmount));
  }
  const out: EarmarkCheck[] = [];
  for (const a of accounts) {
    const earmarked = byAccount.get(a.id) ?? 0;
    if (earmarked > 0 && earmarked > a.balance) {
      out.push({ accountId: a.id, accountBalance: a.balance, earmarked, overAllocated: add(earmarked, -a.balance) });
    }
  }
  return out;
}
