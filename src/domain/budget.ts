import { add, allocate, mulDiv, ratioBps, sum, type Cents } from "./money";
import { daysInMonthKey, type MonthKey } from "./dates";

/* =====================================================================
 * Envelope (zero-based) budgeting
 * ---------------------------------------------------------------------
 * funds(m)      new money that became available to assign in month m
 *               (income-category inflows + starting balances of budget accounts)
 * assigned(c,m) money the user assigned to category c in month m
 * activity(c,m) signed budget activity (spending negative, refunds positive)
 *
 * available(c,m) = carryIn(c,m) + assigned(c,m) + activity(c,m)
 * carryIn(c,m+1) = available(c,m) if positive and the category rolls over, else 0
 *
 * Leftover money in a non-rollover category returns to Ready to Assign next month.
 * Overspending (negative available) is NOT carried in the category: it is deducted
 * from next month's Ready to Assign, so overspending is always paid for explicitly.
 *
 * readyToAssign(m) = readyToAssign(m−1) + funds(m) − Σassigned(m)
 *                    − overspent(m−1) + returned(m−1)
 * ===================================================================== */

export interface EnvelopeCell {
  assigned: Cents;
  activity: Cents;
}

export interface EnvelopeInput {
  months: MonthKey[];
  categories: { id: string; rollover: boolean }[];
  cells: (month: MonthKey, categoryId: string) => EnvelopeCell | undefined;
  funds: (month: MonthKey) => Cents;
}

export interface EnvelopeCategoryResult {
  carryIn: Cents;
  assigned: Cents;
  activity: Cents;
  available: Cents;
  overspent: Cents;
}

export interface EnvelopeMonthResult {
  month: MonthKey;
  fundsIn: Cents;
  /** Overspending from the previous month deducted this month. */
  overspentDeducted: Cents;
  /** Non-rollover leftovers from the previous month returned this month. */
  returned: Cents;
  readyToAssign: Cents;
  totalAssigned: Cents;
  totalActivity: Cents;
  totalAvailable: Cents;
  overspentTotal: Cents;
  categories: Map<string, EnvelopeCategoryResult>;
}

export function computeEnvelope(input: EnvelopeInput): EnvelopeMonthResult[] {
  const carry = new Map<string, Cents>();
  let rta = 0;
  let prevOverspent = 0;
  let prevReturned = 0;
  const results: EnvelopeMonthResult[] = [];

  for (const month of input.months) {
    const fundsIn = input.funds(month);
    rta = add(rta, fundsIn, -prevOverspent, prevReturned);
    const overspentDeducted = prevOverspent;
    const returned = prevReturned;

    const cats = new Map<string, EnvelopeCategoryResult>();
    let totalAssigned = 0;
    let totalActivity = 0;
    let totalAvailable = 0;
    let overspentTotal = 0;
    let returnedNext = 0;

    for (const c of input.categories) {
      const cell = input.cells(month, c.id) ?? { assigned: 0, activity: 0 };
      const carryIn = carry.get(c.id) ?? 0;
      const available = add(carryIn, cell.assigned, cell.activity);
      const overspent = available < 0 ? -available : 0;
      cats.set(c.id, { carryIn, assigned: cell.assigned, activity: cell.activity, available, overspent });
      totalAssigned = add(totalAssigned, cell.assigned);
      totalActivity = add(totalActivity, cell.activity);
      totalAvailable = add(totalAvailable, available);
      overspentTotal = add(overspentTotal, overspent);
      if (available > 0 && c.rollover) carry.set(c.id, available);
      else {
        carry.set(c.id, 0);
        if (available > 0) returnedNext = add(returnedNext, available);
      }
    }

    rta = add(rta, -totalAssigned);
    results.push({
      month,
      fundsIn,
      overspentDeducted,
      returned,
      readyToAssign: rta,
      totalAssigned,
      totalActivity,
      totalAvailable,
      overspentTotal,
      categories: cats,
    });
    prevOverspent = overspentTotal;
    prevReturned = returnedNext;
  }
  return results;
}

/* =====================================================================
 * Flexible (limit) budgeting
 * ===================================================================== */

export type LimitStatus = "ok" | "warning" | "over" | "unbudgeted";

export interface FlexibleCategoryInput {
  id: string;
  limit: Cents;
  spent: Cents; // positive = spent
  alertThresholdBps?: number; // default 8 500 = 85 %
}

export interface FlexibleCategoryResult {
  id: string;
  limit: Cents;
  spent: Cents;
  remaining: Cents;
  usedBps: number | null;
  status: LimitStatus;
}

export function evaluateLimit(c: FlexibleCategoryInput): FlexibleCategoryResult {
  const remaining = add(c.limit, -c.spent);
  const usedBps = ratioBps(c.spent, c.limit);
  let status: LimitStatus;
  if (c.limit <= 0) status = c.spent > 0 ? "unbudgeted" : "ok";
  else if (c.spent > c.limit) status = "over";
  else if ((usedBps ?? 0) >= (c.alertThresholdBps ?? 8_500)) status = "warning";
  else status = "ok";
  return { id: c.id, limit: c.limit, spent: c.spent, remaining, usedBps, status };
}

/* =====================================================================
 * End-of-period projection
 * ===================================================================== */

export interface ProjectionInput {
  month: MonthKey;
  /** Day of month that has fully or partly elapsed (1-based, today's day). */
  dayOfMonth: number;
  spentSoFar: Cents;
  /**
   * Part of spentSoFar that came from recurring bills (matched to a schedule).
   * It is not extrapolated: remaining bills are added via scheduledRemaining instead,
   * so a weekly rent is never counted both as "pace" and as "scheduled".
   */
  fixedSoFar?: Cents;
  /** Average NON-recurring spending in this category across recent full months, if known. */
  historicalMonthlyAverage?: Cents | null;
  /** Scheduled (not yet occurred) spending for the rest of the month. */
  scheduledRemaining?: Cents;
}

export interface Projection {
  projected: Cents;
  method: "pace" | "history" | "blend" | "complete";
  explanation: string;
}

/**
 * Project end-of-month spending. Early in the month the current pace is noisy, so
 * we lean on history; later we lean on the actual pace. Scheduled bills are added
 * on top of the variable estimate. This is an estimate, never a guarantee.
 */
export function projectMonthEnd(p: ProjectionInput): Projection {
  const days = daysInMonthKey(p.month);
  const elapsed = Math.min(Math.max(p.dayOfMonth, 1), days);
  const scheduled = p.scheduledRemaining ?? 0;
  const fixed = Math.max(Math.min(p.fixedSoFar ?? 0, p.spentSoFar), 0);
  const variable = Math.max(add(p.spentSoFar, -fixed), 0);
  if (elapsed >= days) {
    return { projected: p.spentSoFar, method: "complete", explanation: "The month is complete." };
  }
  const pace = mulDiv(variable, days, elapsed);
  const hist = p.historicalMonthlyAverage ?? null;
  let variableProjected: Cents;
  let method: Projection["method"];
  let explanation: string;
  if (hist === null || hist <= 0) {
    variableProjected = Math.max(pace, variable);
    method = "pace";
    explanation = `At your current pace over ${elapsed} of ${days} days.`;
  } else {
    // Weight of current pace grows linearly with the share of the month elapsed.
    variableProjected = Math.max(add(mulDiv(pace, elapsed, days), mulDiv(hist, days - elapsed, days)), variable);
    method = elapsed < 4 ? "history" : "blend";
    explanation =
      elapsed < 4
        ? "Mostly based on your recent monthly average, because the month has only just started."
        : `Blends your pace so far (${elapsed} of ${days} days) with your recent monthly average.`;
  }
  if (fixed > 0 || scheduled > 0) explanation += " Scheduled bills are counted on their due dates rather than extrapolated.";
  return { projected: add(fixed, variableProjected, scheduled), method, explanation };
}

/* =====================================================================
 * Adjustment suggestions (never applied automatically)
 * ===================================================================== */

export interface CategoryHistory {
  id: string;
  name: string;
  budgeted: Cents;
  /** Spending in each recent full month, most recent last. */
  monthlySpending: Cents[];
}

export interface BudgetSuggestion {
  categoryId: string;
  name: string;
  kind: "increase" | "decrease";
  current: Cents;
  suggested: Cents;
  reason: string;
}

export function median(values: Cents[]): Cents {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Round up to a friendly whole-dollar step ($5 under $100, $10 under $1 000, $25 above). */
export function roundUpFriendly(cents: Cents): Cents {
  const step = cents < 10_000 ? 500 : cents < 100_000 ? 1_000 : 2_500;
  return Math.ceil(cents / step) * step;
}

export function suggestAdjustments(history: CategoryHistory[], minMonths = 3): BudgetSuggestion[] {
  const out: BudgetSuggestion[] = [];
  for (const h of history) {
    const months = h.monthlySpending.slice(-minMonths);
    if (months.length < minMonths || h.budgeted <= 0) continue;
    const over = months.filter((m) => m > h.budgeted).length;
    const farUnder = months.filter((m) => m < mulDiv(h.budgeted, 7, 10)).length;
    const med = median(months);
    if (over >= minMonths - 1 && med > h.budgeted) {
      out.push({
        categoryId: h.id,
        name: h.name,
        kind: "increase",
        current: h.budgeted,
        suggested: roundUpFriendly(med),
        reason: `Over budget in ${over} of the last ${months.length} months (median spend ${med}).`,
      });
    } else if (farUnder === months.length) {
      const suggested = roundUpFriendly(mulDiv(Math.max(...months), 11, 10));
      if (suggested < h.budgeted) {
        out.push({
          categoryId: h.id,
          name: h.name,
          kind: "decrease",
          current: h.budgeted,
          suggested,
          reason: `Spending stayed under 70% of the budget for ${months.length} months.`,
        });
      }
    }
  }
  return out;
}

/* =====================================================================
 * Income normalisation & guided starter budget
 * ===================================================================== */

export type IncomeFrequency = "weekly" | "fortnightly" | "monthly" | "irregular";

/** Convert a per-payment amount to an average monthly amount (52/12, 26/12). */
export function monthlyEquivalent(amount: Cents, frequency: IncomeFrequency): Cents {
  switch (frequency) {
    case "weekly":
      return mulDiv(amount, 52, 12);
    case "fortnightly":
      return mulDiv(amount, 26, 12);
    case "monthly":
    case "irregular":
      return amount;
  }
}

export interface StarterInput {
  monthlyIncome: Cents;
  fixed: { categoryKey: string; amount: Cents }[];
  debtMinimums: Cents;
  goalContributions: Cents;
  /** Variable categories the user said they spend on, with an optional typical monthly amount. */
  variable: { categoryKey: string; typical?: Cents | null }[];
}

export interface StarterAllocation {
  categoryKey: string;
  amount: Cents;
  basis: "fixed" | "debt" | "goal" | "typical" | "share" | "leftover";
}

export interface StarterBudget {
  allocations: StarterAllocation[];
  committed: Cents;
  unallocated: Cents;
  shortfall: Cents;
  notes: string[];
}

/** Relative weights used only when the user gives no typical amount for a variable category. */
const VARIABLE_WEIGHTS: Record<string, number> = {
  groceries: 40,
  transport: 15,
  restaurants: 12,
  entertainment: 8,
  shopping: 8,
  health: 6,
  personal_care: 5,
  education: 3,
  miscellaneous: 3,
};

/**
 * Build an editable starter budget from the user's own numbers:
 *   1. fixed expenses exactly as entered,
 *   2. minimum debt repayments,
 *   3. planned goal contributions,
 *   4. variable categories at the typical amount the user gave,
 *   5. remaining money spread across variable categories without a typical amount,
 *      keeping a 10 % buffer unassigned.
 * If commitments exceed income, nothing is invented: variable categories get 0 and
 * the shortfall is reported.
 */
export function buildStarterBudget(input: StarterInput): StarterBudget {
  const notes: string[] = [];
  const allocations: StarterAllocation[] = [];
  for (const f of input.fixed) if (f.amount > 0) allocations.push({ categoryKey: f.categoryKey, amount: f.amount, basis: "fixed" });
  if (input.debtMinimums > 0) allocations.push({ categoryKey: "debt_repayments", amount: input.debtMinimums, basis: "debt" });
  if (input.goalContributions > 0) allocations.push({ categoryKey: "savings", amount: input.goalContributions, basis: "goal" });
  for (const v of input.variable) {
    if (v.typical && v.typical > 0) allocations.push({ categoryKey: v.categoryKey, amount: v.typical, basis: "typical" });
  }
  const committed = sum(allocations.map((a) => a.amount));
  let left = add(input.monthlyIncome, -committed);

  const unsized = input.variable.filter((v) => !v.typical || v.typical <= 0);
  if (left < 0) {
    notes.push("Your fixed costs, debts, goals and typical spending add up to more than your monthly income.");
    for (const v of unsized) allocations.push({ categoryKey: v.categoryKey, amount: 0, basis: "share" });
    return { allocations, committed, unallocated: 0, shortfall: -left, notes };
  }
  if (unsized.length > 0 && left > 0) {
    const buffer = mulDiv(left, 10, 100);
    const spread = add(left, -buffer);
    const weights = unsized.map((v) => VARIABLE_WEIGHTS[v.categoryKey] ?? 5);
    const parts = allocate(spread, weights);
    unsized.forEach((v, i) => {
      // Round down to whole dollars so the plan reads cleanly; the remainder stays unassigned.
      const amount = Math.floor(parts[i] / 100) * 100;
      allocations.push({ categoryKey: v.categoryKey, amount, basis: "share" });
    });
    left = add(input.monthlyIncome, -sum(allocations.map((a) => a.amount)));
    notes.push(
      "Categories without a typical amount share what's left after your commitments. These are starting points based on your numbers, not rules — adjust them to fit your life.",
    );
  }
  if (input.monthlyIncome === 0) notes.push("No regular income was entered, so only your commitments are listed.");
  return { allocations, committed, unallocated: left, shortfall: 0, notes };
}
