import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database, Queryable } from "../db";
import { goalContributions, savingsGoals } from "../db/schema";
import { audit, diff, invalid, notFound, ownedAccount, toCents } from "./common";
import { earmarkWarnings, goalProgress, type ContributionCadence, type GoalProgress } from "@/domain/goals";
import { assertCents } from "@/domain/money";
import { isValidDate, type ISODate } from "@/domain/dates";

export type GoalRow = typeof savingsGoals.$inferSelect;
export type GoalKind = GoalRow["kind"];

export interface GoalView extends GoalRow {
  savedAmount: number;
  progress: GoalProgress;
  contributions: { id: string; date: ISODate; amount: number; note: string | null }[];
}

export async function listGoals(db: Queryable, userId: string, today: ISODate): Promise<GoalView[]> {
  const [goals, saved, recent] = await Promise.all([
    db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)).orderBy(asc(savingsGoals.priority), asc(savingsGoals.createdAt)),
    db
      .select({ goalId: goalContributions.goalId, total: sql<string>`sum(${goalContributions.amount})` })
      .from(goalContributions)
      .where(eq(goalContributions.userId, userId))
      .groupBy(goalContributions.goalId),
    db
      .select()
      .from(goalContributions)
      .where(eq(goalContributions.userId, userId))
      .orderBy(desc(goalContributions.date), desc(goalContributions.createdAt))
      .limit(500),
  ]);
  return goals.map((g) => {
    const savedAmount = toCents(saved.find((s) => s.goalId === g.id)?.total);
    return {
      ...g,
      savedAmount,
      progress: goalProgress(
        {
          targetAmount: g.targetAmount,
          savedAmount,
          targetDate: g.targetDate,
          plannedContribution: g.status === "active" ? g.plannedContribution : null,
          cadence: g.cadence as ContributionCadence,
        },
        today,
      ),
      contributions: recent
        .filter((c) => c.goalId === g.id)
        .slice(0, 20)
        .map((c) => ({ id: c.id, date: c.date, amount: c.amount, note: c.note })),
    };
  });
}

export function goalEarmarkWarnings(goals: GoalView[], accounts: { id: string; balance: number; name: string }[]) {
  return earmarkWarnings(
    accounts,
    goals.map((g) => ({ linkedAccountId: g.linkedAccountId, savedAmount: g.savedAmount, archived: g.status === "archived" || g.status === "completed" })),
  ).map((w) => ({ ...w, accountName: accounts.find((a) => a.id === w.accountId)?.name ?? "" }));
}

export interface GoalInput {
  name: string;
  kind: GoalKind;
  targetAmount: number;
  targetDate?: ISODate | null;
  priority?: number;
  cadence?: ContributionCadence;
  plannedContribution?: number | null;
  linkedAccountId?: string | null;
  /** Amount already saved when the goal is created (recorded as the first contribution). */
  initialSaved?: number;
}

async function validate(db: Queryable, userId: string, input: Partial<GoalInput>) {
  if (input.name !== undefined && (!input.name.trim() || input.name.length > 80)) throw invalid("Name must be 1–80 characters");
  if (input.targetAmount !== undefined) {
    assertCents(input.targetAmount);
    if (input.targetAmount <= 0) throw invalid("Target must be greater than zero");
  }
  if (input.targetDate && !isValidDate(input.targetDate)) throw invalid("Invalid target date");
  if (input.plannedContribution) assertCents(input.plannedContribution);
  if (input.plannedContribution !== undefined && input.plannedContribution !== null && input.plannedContribution < 0) throw invalid("Contribution can't be negative");
  if (input.priority !== undefined && (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 5)) throw invalid("Priority must be 1–5");
  if (input.linkedAccountId) await ownedAccount(db, userId, input.linkedAccountId);
}

export async function createGoal(db: Database, userId: string, input: GoalInput, today: ISODate): Promise<GoalRow> {
  await validate(db, userId, input);
  return db.transaction(async (tx) => {
    const [g] = await tx
      .insert(savingsGoals)
      .values({
        userId,
        name: input.name.trim(),
        kind: input.kind,
        targetAmount: input.targetAmount,
        targetDate: input.targetDate ?? null,
        priority: input.priority ?? 2,
        cadence: input.cadence ?? "monthly",
        plannedContribution: input.plannedContribution ?? null,
        linkedAccountId: input.linkedAccountId ?? null,
      })
      .returning();
    if (input.initialSaved && input.initialSaved > 0) {
      assertCents(input.initialSaved);
      await tx.insert(goalContributions).values({ goalId: g.id, userId, date: today, amount: input.initialSaved, note: "Already saved" });
    }
    await audit(tx, userId, "goal", g.id, "create", { name: g.name, target: g.targetAmount });
    return g;
  });
}

async function ownedGoal(db: Queryable, userId: string, id: string): Promise<GoalRow> {
  const [g] = await db.select().from(savingsGoals).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId)));
  if (!g) throw notFound("Goal");
  return g;
}

export async function updateGoal(db: Database, userId: string, id: string, patch: Partial<GoalInput>): Promise<void> {
  await validate(db, userId, patch);
  await db.transaction(async (tx) => {
    const before = await ownedGoal(tx, userId, id);
    const values: Partial<GoalRow> = {};
    if (patch.name !== undefined) values.name = patch.name.trim();
    if (patch.kind !== undefined) values.kind = patch.kind;
    if (patch.targetAmount !== undefined) values.targetAmount = patch.targetAmount;
    if (patch.targetDate !== undefined) values.targetDate = patch.targetDate;
    if (patch.priority !== undefined) values.priority = patch.priority;
    if (patch.cadence !== undefined) values.cadence = patch.cadence;
    if (patch.plannedContribution !== undefined) values.plannedContribution = patch.plannedContribution;
    if (patch.linkedAccountId !== undefined) values.linkedAccountId = patch.linkedAccountId;
    await tx.update(savingsGoals).set(values).where(eq(savingsGoals.id, id));
    await audit(tx, userId, "goal", id, "update", diff(before, values));
  });
}

export async function setGoalStatus(db: Database, userId: string, id: string, status: GoalRow["status"]): Promise<void> {
  await ownedGoal(db, userId, id);
  await db
    .update(savingsGoals)
    .set({ status, completedAt: status === "completed" ? new Date() : null })
    .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId)));
  await audit(db, userId, "goal", id, `status_${status}`);
}

export async function deleteGoal(db: Database, userId: string, id: string): Promise<void> {
  await ownedGoal(db, userId, id);
  await db.delete(savingsGoals).where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, userId)));
  await audit(db, userId, "goal", id, "delete");
}

/**
 * Record money set aside for (positive) or taken from (negative) a goal.
 * This is an earmark only — it never moves money between accounts.
 */
export async function addContribution(db: Database, userId: string, goalId: string, input: { amount: number; date: ISODate; note?: string | null }) {
  assertCents(input.amount);
  if (input.amount === 0) throw invalid("Amount can't be zero");
  if (!isValidDate(input.date)) throw invalid("Invalid date");
  return db.transaction(async (tx) => {
    const g = await ownedGoal(tx, userId, goalId);
    const [{ total }] = await tx
      .select({ total: sql<string>`coalesce(sum(${goalContributions.amount}), 0)` })
      .from(goalContributions)
      .where(eq(goalContributions.goalId, goalId));
    const after = toCents(total) + input.amount;
    if (after < 0) throw invalid("You can't withdraw more than is saved for this goal");
    await tx.insert(goalContributions).values({ goalId, userId, date: input.date, amount: input.amount, note: input.note?.trim() || null });
    if (g.status === "active" && after >= g.targetAmount) {
      await tx.update(savingsGoals).set({ status: "completed", completedAt: new Date() }).where(eq(savingsGoals.id, goalId));
    }
    await audit(tx, userId, "goal", goalId, "contribution", { amount: input.amount, date: input.date });
    return { saved: after, completed: g.status === "active" && after >= g.targetAmount };
  });
}

export async function deleteContribution(db: Database, userId: string, contributionId: string) {
  const res = await db
    .delete(goalContributions)
    .where(and(eq(goalContributions.id, contributionId), eq(goalContributions.userId, userId)))
    .returning();
  if (!res.length) throw notFound("Contribution");
  await audit(db, userId, "goal", res[0].goalId, "contribution_delete", { amount: res[0].amount });
}
