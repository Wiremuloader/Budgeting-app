import { and, eq, isNull } from "drizzle-orm";
import type { Queryable } from "../db";
import { categories, notificationPreferences, userPreferences, NOTIFICATION_TYPES } from "../db/schema";

/**
 * Default category template. Users can rename, reorder, archive and add to these;
 * `systemKey` lets onboarding and the starter budget find them after a rename.
 */
export const DEFAULT_CATEGORIES: { key: string; name: string; group: "income" | "expense"; icon: string; rollover?: boolean }[] = [
  { key: "salary", name: "Salary & wages", group: "income", icon: "briefcase" },
  { key: "side_income", name: "Side income", group: "income", icon: "sparkles" },
  { key: "benefits", name: "Benefits & support", group: "income", icon: "hand-heart" },
  { key: "interest_income", name: "Interest earned", group: "income", icon: "percent" },
  { key: "other_income", name: "Other income", group: "income", icon: "plus-circle" },
  { key: "housing", name: "Housing", group: "expense", icon: "home" },
  { key: "groceries", name: "Groceries", group: "expense", icon: "shopping-basket" },
  { key: "restaurants", name: "Restaurants & takeaway", group: "expense", icon: "utensils" },
  { key: "transport", name: "Transport", group: "expense", icon: "car" },
  { key: "utilities", name: "Utilities", group: "expense", icon: "zap" },
  { key: "phone_internet", name: "Phone & internet", group: "expense", icon: "wifi" },
  { key: "subscriptions", name: "Subscriptions", group: "expense", icon: "repeat" },
  { key: "health", name: "Health", group: "expense", icon: "heart-pulse" },
  { key: "education", name: "Education", group: "expense", icon: "graduation-cap" },
  { key: "entertainment", name: "Entertainment", group: "expense", icon: "ticket" },
  { key: "shopping", name: "Shopping", group: "expense", icon: "shopping-bag" },
  { key: "personal_care", name: "Personal care", group: "expense", icon: "sparkle" },
  { key: "insurance", name: "Insurance", group: "expense", icon: "shield" },
  { key: "debt_repayments", name: "Debt repayments", group: "expense", icon: "landmark" },
  { key: "savings", name: "Savings", group: "expense", icon: "piggy-bank" },
  { key: "fees", name: "Interest & fees", group: "expense", icon: "receipt" },
  { key: "gifts", name: "Gifts & donations", group: "expense", icon: "gift" },
  { key: "miscellaneous", name: "Miscellaneous", group: "expense", icon: "circle-dot" },
];

const DEFAULT_THRESHOLDS: Partial<Record<(typeof NOTIFICATION_TYPES)[number], number>> = {
  budget_approaching: 8500, // bps
  bill_upcoming: 3, // days ahead
  low_balance: 0, // cents — uses preferences.lowBalanceThreshold when 0
};

/** Idempotent: safe to call on every sign-in. */
export async function ensureUserBootstrap(db: Queryable, userId: string): Promise<void> {
  await db.insert(userPreferences).values({ userId }).onConflictDoNothing();
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.userId, userId), isNull(categories.archivedAt)))
    .limit(1);
  if (existing.length === 0) {
    await db
      .insert(categories)
      .values(
        DEFAULT_CATEGORIES.map((c, i) => ({
          userId,
          name: c.name,
          group: c.group,
          systemKey: c.key,
          icon: c.icon,
          sortOrder: i,
          rollover: c.rollover ?? true,
        })),
      )
      .onConflictDoNothing();
  }
  await db
    .insert(notificationPreferences)
    .values(NOTIFICATION_TYPES.map((type) => ({ userId, type, enabled: true, threshold: DEFAULT_THRESHOLDS[type] ?? null })))
    .onConflictDoNothing();
}
