import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database, Queryable } from "../db";
import { categories } from "../db/schema";
import { audit, diff, invalid, ownedCategory, type CategoryRow } from "./common";

export async function listCategories(db: Queryable, userId: string, opts: { includeArchived?: boolean } = {}): Promise<CategoryRow[]> {
  return db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), opts.includeArchived ? undefined : isNull(categories.archivedAt)))
    .orderBy(asc(categories.group), asc(categories.sortOrder), asc(categories.name));
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export interface CategoryInput {
  name: string;
  group: "income" | "expense";
  parentId?: string | null;
  icon?: string | null;
  color?: string | null;
  rollover?: boolean;
  alertThresholdBps?: number;
  alertsEnabled?: boolean;
}

export async function createCategory(db: Database, userId: string, input: CategoryInput): Promise<CategoryRow> {
  const name = input.name.trim();
  if (!name || name.length > 60) throw invalid("Name must be 1–60 characters");
  try {
    return await db.transaction(async (tx) => {
      if (input.parentId) {
        const parent = await ownedCategory(tx, userId, input.parentId);
        if (parent.group !== input.group) throw invalid("A subcategory must be in the same group as its parent");
        if (parent.parentId) throw invalid("Subcategories can only be one level deep");
      }
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${categories.sortOrder}), -1)::int + 1` })
        .from(categories)
        .where(eq(categories.userId, userId));
      const [row] = await tx
        .insert(categories)
        .values({
          userId,
          name,
          group: input.group,
          parentId: input.parentId ?? null,
          icon: input.icon ?? null,
          color: input.color ?? null,
          rollover: input.rollover ?? true,
          alertThresholdBps: input.alertThresholdBps ?? 8500,
          alertsEnabled: input.alertsEnabled ?? true,
          sortOrder: next,
        })
        .returning();
      await audit(tx, userId, "category", row.id, "create", { name });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw invalid(`A category called "${name}" already exists`);
    throw e;
  }
}

export async function updateCategory(db: Database, userId: string, id: string, patch: Partial<Omit<CategoryInput, "group">>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const before = await ownedCategory(tx, userId, id, { allowArchived: true });
      const values: Partial<CategoryRow> = {};
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name || name.length > 60) throw invalid("Name must be 1–60 characters");
        values.name = name;
      }
      if (patch.icon !== undefined) values.icon = patch.icon;
      if (patch.color !== undefined) values.color = patch.color;
      if (patch.rollover !== undefined) values.rollover = patch.rollover;
      if (patch.alertsEnabled !== undefined) values.alertsEnabled = patch.alertsEnabled;
      if (patch.alertThresholdBps !== undefined) {
        if (!Number.isInteger(patch.alertThresholdBps) || patch.alertThresholdBps < 1000 || patch.alertThresholdBps > 10000) {
          throw invalid("Alert threshold must be between 10% and 100%");
        }
        values.alertThresholdBps = patch.alertThresholdBps;
      }
      if (patch.parentId !== undefined) {
        if (patch.parentId === id) throw invalid("A category can't be its own parent");
        if (patch.parentId) {
          const parent = await ownedCategory(tx, userId, patch.parentId);
          if (parent.group !== before.group) throw invalid("Parent must be in the same group");
          if (parent.parentId) throw invalid("Subcategories can only be one level deep");
        }
        values.parentId = patch.parentId;
      }
      await tx.update(categories).set(values).where(and(eq(categories.id, id), eq(categories.userId, userId)));
      await audit(tx, userId, "category", id, "update", diff(before, values));
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw invalid("Another category already has that name");
    throw e;
  }
}

/**
 * Archiving keeps all historical transactions, splits and past budget allocations
 * pointing at the category, so reports for earlier periods stay unchanged. The category
 * disappears from pickers and from budgets for months after it was archived.
 */
export async function setCategoryArchived(db: Database, userId: string, id: string, archived: boolean): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await ownedCategory(tx, userId, id, { allowArchived: true });
      await tx
        .update(categories)
        .set({ archivedAt: archived ? new Date() : null })
        .where(and(eq(categories.id, id), eq(categories.userId, userId)));
      if (archived) {
        // Children follow their parent.
        await tx.update(categories).set({ archivedAt: new Date() }).where(and(eq(categories.parentId, id), eq(categories.userId, userId)));
      }
      await audit(tx, userId, "category", id, archived ? "archive" : "unarchive");
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw invalid("An active category already uses that name. Rename one first.");
    throw e;
  }
}

export async function reorderCategories(db: Database, userId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, id] of orderedIds.entries()) {
      await tx.update(categories).set({ sortOrder: i }).where(and(eq(categories.id, id), eq(categories.userId, userId)));
    }
  });
}
