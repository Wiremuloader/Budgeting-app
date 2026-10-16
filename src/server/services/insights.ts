import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { Database, Queryable } from "../db";
import { insightDismissals, transactions } from "../db/schema";
import type { BudgetMonthView } from "./budget";
import type { ForecastBundle } from "./forecast";
import type { GoalView } from "./goals";
import type { Occurrence } from "./recurring";
import { ledgerLines } from "./transactions";
import {
  categoryAboveAverage,
  goalAcceleration,
  incomeMissing,
  largeTransaction,
  lowBalanceForecast,
  projectedOverspend,
  rankInsights,
  uncategorised,
  upcomingBills,
  type Insight,
} from "@/domain/insights";
import { median } from "@/domain/budget";
import { addDays, monthKey, type ISODate } from "@/domain/dates";
import type { ContributionCadence } from "@/domain/goals";

export async function dismissedInsightKeys(db: Queryable, userId: string): Promise<Set<string>> {
  const rows = await db.select({ k: insightDismissals.insightKey }).from(insightDismissals).where(eq(insightDismissals.userId, userId));
  return new Set(rows.map((r) => r.k));
}

export async function dismissInsight(db: Database, userId: string, key: string) {
  if (!key || key.length > 200) return;
  await db.insert(insightDismissals).values({ userId, insightKey: key }).onConflictDoNothing();
}

export async function buildInsights(
  db: Queryable,
  userId: string,
  ctx: {
    today: ISODate;
    currency: string;
    budget: BudgetMonthView;
    forecast: ForecastBundle;
    occurrences: Occurrence[];
    goals: GoalView[];
    lowBalanceThreshold: number;
  },
  limit = 6,
): Promise<Insight[]> {
  const { today, currency, budget } = ctx;
  const month = monthKey(today);
  const list: (Insight | null)[] = [];

  for (const c of budget.categories) {
    if (c.projected === null) continue;
    list.push(projectedOverspend({ categoryId: c.id, name: c.name, month, budgeted: c.assigned + c.carryIn, spentSoFar: c.spent, projected: c.projected }, currency));
    // Skip "above average" when the category is already over budget — one message is enough.
    if (c.averageSpent !== null && !(c.assigned + c.carryIn > 0 && c.spent > c.assigned + c.carryIn)) {
      // averageSpent covers the three full months before this one.
      list.push(
        categoryAboveAverage(
          { categoryId: c.id, name: c.name, month, projected: c.projected, spentSoFar: c.spent, average: c.averageSpent, historyMonths: 3 },
          currency,
        ),
      );
    }
  }

  list.push(
    ...upcomingBills(
      ctx.occurrences.filter((o) => o.status === "upcoming" || o.status === "due").map((o) => ({ ruleId: o.ruleId, name: o.name, date: o.date, amount: o.amount })),
      today,
      currency,
    ).slice(0, 3),
  );
  for (const o of ctx.occurrences) {
    if (o.kind === "income" && (o.status === "late" || o.status === "missed") && o.date >= addDays(today, -10)) {
      list.push(incomeMissing(o.ruleId, o.name, o.date, o.amount, today, currency));
    }
  }

  list.push(lowBalanceForecast(ctx.forecast.forecast, ctx.lowBalanceThreshold, currency));

  for (const g of ctx.goals.filter((x) => x.status === "active")) {
    list.push(
      goalAcceleration(
        {
          id: g.id,
          name: g.name,
          targetAmount: g.targetAmount,
          savedAmount: g.savedAmount,
          targetDate: g.targetDate,
          plannedContribution: g.plannedContribution,
          cadence: g.cadence as ContributionCadence,
        },
        today,
        currency,
      ),
    );
  }

  // Large transactions in the last 7 days vs the category's 90-day median.
  const lines = await ledgerLines(db, userId, { from: addDays(today, -90), to: today }, { kinds: ["standard"] });
  const byCat = new Map<string, number[]>();
  for (const l of lines) if (l.amount < 0 && l.categoryId) byCat.set(l.categoryId, [...(byCat.get(l.categoryId) ?? []), -l.amount]);
  const catNames = new Map(budget.categories.map((c) => [c.id, c.name]));
  for (const l of lines.filter((x) => x.date >= addDays(today, -7) && x.amount < 0 && x.categoryId)) {
    const others = (byCat.get(l.categoryId!) ?? []).filter((v) => v !== -l.amount);
    if (others.length < 4) continue;
    list.push(
      largeTransaction(
        { id: l.transactionId, date: l.date, merchant: l.merchant, amount: l.amount, categoryName: catNames.get(l.categoryId!) ?? null, categoryMedian: median(others) },
        currency,
      ),
    );
  }

  const [unc] = await db
    .select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(-sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.kind, "standard"),
        isNull(transactions.categoryId),
        eq(transactions.isSplit, false),
        sql`${transactions.amount} < 0`,
        gte(transactions.date, addDays(today, -60)),
      ),
    );
  list.push(uncategorised(unc.n, Number(unc.total), month, currency));

  return rankInsights(list, await dismissedInsightKeys(db, userId), limit);
}
