import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { Database, Queryable } from "../db";
import { budgetAllocations, budgetPeriods, categories, financialAccounts, transactions, userPreferences } from "../db/schema";
import { audit, invalid, ownedCategory, toCents } from "./common";
import { budgetActivityLines, ledgerLines, type LedgerLineWithMeta } from "./transactions";
import { occurrences } from "./recurring";
import {
  computeEnvelope,
  evaluateLimit,
  projectMonthEnd,
  suggestAdjustments,
  type BudgetSuggestion,
  type LimitStatus,
} from "@/domain/budget";
import {
  addMonthKey,
  isValidMonthKey,
  monthEnd,
  monthKey,
  monthRange,
  monthStart,
  parseDate,
  type ISODate,
  type MonthKey,
} from "@/domain/dates";
import { add, assertCents, ratioBps, sum } from "@/domain/money";
import { isCash, isLiability, type AccountType } from "@/domain/ledger";

export interface BudgetCategoryView {
  id: string;
  name: string;
  icon: string | null;
  parentId: string | null;
  rollover: boolean;
  archived: boolean;
  alertThresholdBps: number;
  assigned: number;
  activity: number;
  /** Positive amount spent (net of refunds). */
  spent: number;
  carryIn: number;
  available: number;
  overspent: number;
  remaining: number;
  usedBps: number | null;
  status: LimitStatus;
  projected: number | null;
  projectionNote: string | null;
  previousSpent: number;
  averageSpent: number | null;
  scheduledRemaining: number;
  pendingSpent: number;
}

export interface BudgetMonthView {
  month: MonthKey;
  method: "envelope" | "flexible";
  startMonth: MonthKey;
  isCurrent: boolean;
  isFuture: boolean;
  categories: BudgetCategoryView[];
  readyToAssign: number;
  fundsIn: number;
  income: number;
  expectedIncome: number;
  totalAssigned: number;
  totalSpent: number;
  totalAvailable: number;
  overspentTotal: number;
  overspentDeducted: number;
  uncategorisedOutflows: number;
  uncategorisedInflows: number;
  uncategorisedTransfersOut: number;
  /** Flexible mode: planned limits exceed expected income. */
  overPlanned: number;
  suggestions: BudgetSuggestion[];
  hasAllocations: boolean;
  previousMonthHasAllocations: boolean;
}

interface Funds {
  income: number;
  adjustments: number;
  transfersIn: number;
  transfersOut: number;
  uncategorisedOut: number;
  uncategorisedIn: number;
}

async function budgetAccountTypes(db: Queryable, userId: string) {
  const rows = await db
    .select({ id: financialAccounts.id, type: financialAccounts.type, onBudget: financialAccounts.onBudget })
    .from(financialAccounts)
    .where(eq(financialAccounts.userId, userId));
  const onBudget = new Set(rows.filter((r) => r.onBudget && isCash(r.type as AccountType)).map((r) => r.id));
  const types = new Map(rows.map((r) => [r.id, r.type as AccountType]));
  return { onBudget, types };
}

async function transferCounterparts(db: Queryable, userId: string, lines: LedgerLineWithMeta[]) {
  const ids = lines.filter((l) => l.kind === "transfer").map((l) => l.transactionId);
  if (!ids.length) return new Map<string, string>();
  const rows = await db.execute<{ id: string; other: string }>(sql`
    select t.id, o.account_id as other
    from ${transactions} t
    join ${transactions} o on o.transfer_group_id = t.transfer_group_id and o.id <> t.id
    where t.user_id = ${userId} and t.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  return new Map(rows.rows.map((r) => [r.id, r.other]));
}

function computeFunds(
  lines: LedgerLineWithMeta[],
  onBudget: Set<string>,
  types: Map<string, AccountType>,
  counterparts: Map<string, string>,
): Map<MonthKey, Funds> {
  const out = new Map<MonthKey, Funds>();
  const get = (m: MonthKey) => {
    let f = out.get(m);
    if (!f) out.set(m, (f = { income: 0, adjustments: 0, transfersIn: 0, transfersOut: 0, uncategorisedOut: 0, uncategorisedIn: 0 }));
    return f;
  };
  for (const l of lines) {
    const f = get(monthKey(l.date));
    if (l.kind === "standard") {
      if (l.categoryGroup === "income") f.income = add(f.income, l.amount);
      else if (l.categoryGroup === null && l.amount < 0) f.uncategorisedOut = add(f.uncategorisedOut, -l.amount);
      else if (l.categoryGroup === null && l.amount > 0) f.uncategorisedIn = add(f.uncategorisedIn, l.amount);
    } else if (l.kind === "adjustment") {
      if (onBudget.has(l.accountId)) f.adjustments = add(f.adjustments, l.amount);
    } else if (l.kind === "transfer") {
      if (!onBudget.has(l.accountId)) continue;
      const other = counterparts.get(l.transactionId);
      if (!other || onBudget.has(other)) continue; // internal move between budget accounts
      if (l.amount > 0) f.transfersIn = add(f.transfersIn, l.amount);
      else if (l.categoryId === null && !isLiability(types.get(other) ?? "other_asset")) {
        // Money leaving the budget to an off-budget asset (e.g. investments) without a category.
        f.transfersOut = add(f.transfersOut, -l.amount);
      }
      // Uncategorised payments to liabilities are assumed to pay for card purchases already budgeted.
    }
  }
  return out;
}

export async function resolveStartMonth(db: Queryable, userId: string, prefsStart: string | null, month: MonthKey): Promise<MonthKey> {
  if (prefsStart && isValidMonthKey(prefsStart)) return prefsStart <= month ? prefsStart : month;
  const [first] = await db
    .select({ d: sql<string | null>`min(${transactions.date})` })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  const m = first?.d ? monthKey(first.d) : month;
  return m <= month ? m : month;
}

export async function getBudgetMonth(
  db: Queryable,
  userId: string,
  month: MonthKey,
  prefs: { budgetMethod: "envelope" | "flexible"; budgetStartMonth: string | null },
  today: ISODate,
): Promise<BudgetMonthView> {
  if (!isValidMonthKey(month)) throw invalid("Invalid month");
  const method = prefs.budgetMethod;
  const startMonth = await resolveStartMonth(db, userId, prefs.budgetStartMonth, month);
  const historyStart = addMonthKey(month, -3) < startMonth ? addMonthKey(month, -3) : startMonth;
  const envelopeMonths = monthRange(startMonth, month);
  const currentMonth = monthKey(today);

  const [cats, allocs, rawLines, { onBudget, types }, openingRow] = await Promise.all([
    db.select().from(categories).where(and(eq(categories.userId, userId), eq(categories.group, "expense"))),
    db
      .select({ month: budgetPeriods.month, categoryId: budgetAllocations.categoryId, assigned: budgetAllocations.assigned })
      .from(budgetAllocations)
      .innerJoin(budgetPeriods, eq(budgetPeriods.id, budgetAllocations.periodId))
      .where(and(eq(budgetAllocations.userId, userId), gte(budgetPeriods.month, historyStart), lte(budgetPeriods.month, month))),
    ledgerLines(db, userId, { from: monthStart(historyStart), to: monthEnd(month) }, { includeCategorisedTransfers: true }),
    budgetAccountTypes(db, userId),
    db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
      .where(
        and(
          eq(transactions.userId, userId),
          lt(transactions.date, monthStart(startMonth)),
          eq(financialAccounts.onBudget, true),
          inArray(financialAccounts.type, ["checking", "savings", "cash"]),
        ),
      ),
  ]);
  const openingBalance = toCents(openingRow[0]?.total);
  const counterparts = await transferCounterparts(db, userId, rawLines);
  const funds = computeFunds(rawLines, onBudget, types, counterparts);
  const activityLines = budgetActivityLines(rawLines).filter((l) => l.categoryGroup !== "income" && l.categoryId !== null);

  const activity = new Map<string, number>(); // `${month}|${cat}`
  const fixedActivity = new Map<string, number>(); // part matched to recurring rules
  const pending = new Map<string, number>();
  for (const l of activityLines) {
    const k = `${monthKey(l.date)}|${l.categoryId}`;
    activity.set(k, add(activity.get(k) ?? 0, l.amount));
    if (l.recurringRuleId) fixedActivity.set(k, add(fixedActivity.get(k) ?? 0, l.amount));
    if (l.status === "pending" && l.amount < 0) pending.set(k, add(pending.get(k) ?? 0, -l.amount));
  }
  const assigned = new Map(allocs.map((a) => [`${a.month}|${a.categoryId}`, a.assigned]));

  // Show active categories plus archived ones that still have money or activity this month.
  const visible = cats.filter((c) => {
    if (!c.archivedAt) return true;
    const k = `${month}|${c.id}`;
    return (activity.get(k) ?? 0) !== 0 || (assigned.get(k) ?? 0) !== 0;
  });
  visible.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const fundsFor = (m: MonthKey) => {
    const f = funds.get(m);
    const base = f ? add(f.income, f.adjustments, f.transfersIn, -f.transfersOut, -f.uncategorisedOut) : 0;
    return m === startMonth ? add(base, openingBalance) : base;
  };

  const envelope = computeEnvelope({
    months: envelopeMonths,
    categories: cats.map((c) => ({ id: c.id, rollover: c.rollover })),
    cells: (m, c) => ({ assigned: assigned.get(`${m}|${c}`) ?? 0, activity: activity.get(`${m}|${c}`) ?? 0 }),
    funds: fundsFor,
  });
  const result = envelope[envelope.length - 1];

  // Scheduled, unpaid bills for the rest of the month (current month only).
  const scheduled = new Map<string, number>();
  if (month === currentMonth) {
    const occ = await occurrences(db, userId, today, monthEnd(month), today);
    for (const o of occ) {
      if (o.status === "paid" || o.amount >= 0 || !o.categoryId) continue;
      if (o.date === today) continue; // may already be reflected in today's spending
      scheduled.set(o.categoryId, add(scheduled.get(o.categoryId) ?? 0, -o.amount));
    }
  }

  const prevMonth = addMonthKey(month, -1);
  const historyMonths = [addMonthKey(month, -3), addMonthKey(month, -2), prevMonth];
  const dayOfMonth = month === currentMonth ? parseDate(today).day : month < currentMonth ? 31 : 0;

  const views: BudgetCategoryView[] = visible.map((c) => {
    const act = activity.get(`${month}|${c.id}`) ?? 0;
    const env = result.categories.get(c.id)!;
    const asg = assigned.get(`${month}|${c.id}`) ?? 0;
    const spent = -act;
    const histMonths = historyMonths.filter((m) => m >= historyStart);
    const histSpent = histMonths.map((m) => -(activity.get(`${m}|${c.id}`) ?? 0));
    const histVariable = histMonths.map((m) => -add(activity.get(`${m}|${c.id}`) ?? 0, -(fixedActivity.get(`${m}|${c.id}`) ?? 0)));
    const avg = histSpent.length >= 3 ? Math.round(sum(histSpent) / histSpent.length) : null;
    const avgVariable = histVariable.length >= 3 ? Math.round(sum(histVariable) / histVariable.length) : null;
    const limitEval = evaluateLimit({ id: c.id, limit: asg, spent, alertThresholdBps: c.alertThresholdBps });
    let projected: number | null = null;
    let note: string | null = null;
    if (month === currentMonth) {
      const p = projectMonthEnd({
        month,
        dayOfMonth,
        spentSoFar: Math.max(spent, 0),
        fixedSoFar: -(fixedActivity.get(`${month}|${c.id}`) ?? 0),
        historicalMonthlyAverage: avgVariable,
        scheduledRemaining: scheduled.get(c.id) ?? 0,
      });
      projected = p.projected;
      note = p.explanation;
    } else if (month < currentMonth) {
      projected = spent;
    }
    const available = method === "envelope" ? env.available : add(asg, -spent);
    let status: LimitStatus = limitEval.status;
    if (method === "envelope") {
      status = env.available < 0 ? "over" : asg + env.carryIn > 0 && ratioBps(spent, add(asg, env.carryIn))! >= c.alertThresholdBps ? "warning" : spent > 0 && asg + env.carryIn <= 0 ? "unbudgeted" : "ok";
    }
    return {
      id: c.id,
      name: c.name,
      icon: c.icon,
      parentId: c.parentId,
      rollover: c.rollover,
      archived: Boolean(c.archivedAt),
      alertThresholdBps: c.alertThresholdBps,
      assigned: asg,
      activity: act,
      spent,
      carryIn: method === "envelope" ? env.carryIn : 0,
      available,
      overspent: available < 0 ? -available : 0,
      remaining: available,
      usedBps: method === "envelope" ? ratioBps(spent, add(asg, env.carryIn)) : limitEval.usedBps,
      status,
      projected,
      projectionNote: note,
      previousSpent: -(activity.get(`${prevMonth}|${c.id}`) ?? 0),
      averageSpent: avg,
      scheduledRemaining: scheduled.get(c.id) ?? 0,
      pendingSpent: pending.get(`${month}|${c.id}`) ?? 0,
    };
  });

  const f = funds.get(month);
  const income = f?.income ?? 0;
  // Expected income for the month: the larger of recorded income and scheduled income.
  const occ = await occurrences(db, userId, monthStart(month), monthEnd(month), today);
  const scheduledIncome = sum(occ.filter((o) => o.kind === "income").map((o) => o.amount));
  const expectedIncome = Math.max(income, scheduledIncome);
  const totalAssigned = sum(views.map((v) => v.assigned));
  const suggestions = suggestAdjustments(
    views.map((v) => ({
      id: v.id,
      name: v.name,
      budgeted: v.assigned,
      monthlySpending: historyMonths.filter((m) => m >= historyStart).map((m) => -(activity.get(`${m}|${v.id}`) ?? 0)),
    })),
  );

  return {
    month,
    method,
    startMonth,
    isCurrent: month === currentMonth,
    isFuture: month > currentMonth,
    categories: views,
    readyToAssign: result.readyToAssign,
    fundsIn: result.fundsIn,
    income,
    expectedIncome,
    totalAssigned,
    totalSpent: sum(views.map((v) => v.spent)),
    totalAvailable: sum(views.map((v) => v.available)),
    overspentTotal: sum(views.map((v) => v.overspent)),
    overspentDeducted: result.overspentDeducted,
    uncategorisedOutflows: f?.uncategorisedOut ?? 0,
    uncategorisedInflows: f?.uncategorisedIn ?? 0,
    uncategorisedTransfersOut: f?.transfersOut ?? 0,
    overPlanned: method === "flexible" && expectedIncome > 0 ? Math.max(add(totalAssigned, -expectedIncome), 0) : 0,
    suggestions,
    hasAllocations: allocs.some((a) => a.month === month),
    previousMonthHasAllocations: allocs.some((a) => a.month === prevMonth),
  };
}

/* ------------------------------------------------------------ mutations */

async function ensurePeriod(db: Queryable, userId: string, month: MonthKey): Promise<string> {
  if (!isValidMonthKey(month)) throw invalid("Invalid month");
  await db.insert(budgetPeriods).values({ userId, month }).onConflictDoNothing();
  const [p] = await db.select({ id: budgetPeriods.id }).from(budgetPeriods).where(and(eq(budgetPeriods.userId, userId), eq(budgetPeriods.month, month)));
  return p.id;
}

export async function setAssigned(db: Database, userId: string, month: MonthKey, categoryId: string, amount: number, source: "user" | "assistant" = "user") {
  assertCents(amount);
  if (amount < 0) throw invalid("Assigned amounts can't be negative. Move money between categories instead.");
  await db.transaction(async (tx) => {
    const cat = await ownedCategory(tx, userId, categoryId);
    if (cat.group !== "expense") throw invalid("Only spending categories can be budgeted");
    const periodId = await ensurePeriod(tx, userId, month);
    const [prev] = await tx
      .select({ assigned: budgetAllocations.assigned })
      .from(budgetAllocations)
      .where(and(eq(budgetAllocations.periodId, periodId), eq(budgetAllocations.categoryId, categoryId)));
    await tx
      .insert(budgetAllocations)
      .values({ periodId, userId, categoryId, assigned: amount })
      .onConflictDoUpdate({ target: [budgetAllocations.periodId, budgetAllocations.categoryId], set: { assigned: amount } });
    await audit(tx, userId, "budget", `${month}:${categoryId}`, "set_assigned", { from: prev?.assigned ?? 0, to: amount }, source);
  });
}

/** Envelope: move money between two categories within a month. Totals are unchanged. */
export async function moveMoney(db: Database, userId: string, month: MonthKey, fromCategoryId: string, toCategoryId: string, amount: number) {
  assertCents(amount);
  if (amount <= 0) throw invalid("Amount must be greater than zero");
  if (fromCategoryId === toCategoryId) throw invalid("Choose two different categories");
  await db.transaction(async (tx) => {
    await ownedCategory(tx, userId, fromCategoryId);
    await ownedCategory(tx, userId, toCategoryId);
    const periodId = await ensurePeriod(tx, userId, month);
    for (const [categoryId, delta] of [
      [fromCategoryId, -amount],
      [toCategoryId, amount],
    ] as const) {
      await tx
        .insert(budgetAllocations)
        .values({ periodId, userId, categoryId, assigned: delta })
        .onConflictDoUpdate({
          target: [budgetAllocations.periodId, budgetAllocations.categoryId],
          set: { assigned: sql`${budgetAllocations.assigned} + ${delta}` },
        });
    }
    // Assigned may go negative on the source when moving out carried-over money; that is how
    // envelope budgets represent "take from what rolled over". Available stays exact.
    await audit(tx, userId, "budget", `${month}:${fromCategoryId}`, "move_money", { to: toCategoryId, amount });
  });
}

/** Copy last month's assigned amounts into categories with no allocation this month. Explicit user action. */
export async function copyPreviousMonth(db: Database, userId: string, month: MonthKey): Promise<number> {
  const prev = addMonthKey(month, -1);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ categoryId: budgetAllocations.categoryId, assigned: budgetAllocations.assigned })
      .from(budgetAllocations)
      .innerJoin(budgetPeriods, eq(budgetPeriods.id, budgetAllocations.periodId))
      .innerJoin(categories, eq(categories.id, budgetAllocations.categoryId))
      .where(and(eq(budgetAllocations.userId, userId), eq(budgetPeriods.month, prev), sql`${categories.archivedAt} is null`));
    if (!rows.length) return 0;
    const periodId = await ensurePeriod(tx, userId, month);
    const inserted = await tx
      .insert(budgetAllocations)
      .values(rows.filter((r) => r.assigned > 0).map((r) => ({ periodId, userId, categoryId: r.categoryId, assigned: r.assigned })))
      .onConflictDoNothing()
      .returning({ id: budgetAllocations.id });
    await audit(tx, userId, "budget", month, "copy_previous", { count: inserted.length });
    return inserted.length;
  });
}

/** Apply a set of allocations (from the starter budget or accepted suggestions). */
export async function applyAllocations(
  db: Database,
  userId: string,
  month: MonthKey,
  allocations: { categoryId: string; amount: number }[],
  source: "user" | "assistant" | "system" = "user",
) {
  await db.transaction(async (tx) => {
    const periodId = await ensurePeriod(tx, userId, month);
    for (const a of allocations) {
      assertCents(a.amount);
      if (a.amount < 0) throw invalid("Allocations can't be negative");
      const cat = await ownedCategory(tx, userId, a.categoryId);
      if (cat.group !== "expense") throw invalid("Only spending categories can be budgeted");
      await tx
        .insert(budgetAllocations)
        .values({ periodId, userId, categoryId: a.categoryId, assigned: a.amount })
        .onConflictDoUpdate({ target: [budgetAllocations.periodId, budgetAllocations.categoryId], set: { assigned: a.amount } });
    }
    await audit(tx, userId, "budget", month, "apply_allocations", { count: allocations.length }, source);
  });
}

export async function setBudgetMethod(db: Database, userId: string, method: "envelope" | "flexible") {
  await db.update(userPreferences).set({ budgetMethod: method }).where(eq(userPreferences.userId, userId));
  await audit(db, userId, "preferences", userId, "budget_method", { method });
}

export function monthOptions(today: ISODate, startMonth: MonthKey | null): MonthKey[] {
  const current = monthKey(today);
  const first = startMonth && startMonth < addMonthKey(current, -24) ? addMonthKey(current, -24) : (startMonth ?? addMonthKey(current, -12));
  return monthRange(first < current ? first : current, addMonthKey(current, 2));
}
