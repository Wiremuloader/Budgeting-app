import { and, eq, gte } from "drizzle-orm";
import type { Database } from "../db";
import { transactions } from "../db/schema";
import { draftNotifications, getPreferencesMap, saveNotifications } from "./notifications";
import { getBudgetMonth } from "./budget";
import { listRules } from "./recurring";
import type { Overview } from "./overview";
import type { Preferences } from "../auth/session";
import { findPossibleDuplicates } from "@/domain/duplicates";
import { addDays, monthKey, type ISODate } from "@/domain/dates";
import { log, errorFields } from "../log";

const lastRun = new Map<string, number>();

/**
 * Evaluate notification rules from data the overview already computed. Runs at most
 * every 10 minutes per user per process; the dedupe key makes repeats harmless anyway.
 * Failures never break the page.
 */
export async function evaluateNotifications(db: Database, userId: string, prefs: Preferences, today: ISODate, overview: Overview): Promise<void> {
  const now = Date.now();
  if ((lastRun.get(userId) ?? 0) > now - 10 * 60_000) return;
  lastRun.set(userId, now);
  try {
    const [map, budget, rules, recent] = await Promise.all([
      getPreferencesMap(db, userId),
      getBudgetMonth(db, userId, monthKey(today), prefs, today),
      listRules(db, userId, today),
      db
        .select({ id: transactions.id, accountId: transactions.accountId, date: transactions.date, amount: transactions.amount, merchantKey: transactions.merchantKey, merchant: transactions.merchant, externalId: transactions.externalId, kind: transactions.kind })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), gte(transactions.date, addDays(today, -14)))),
    ]);
    const outflows = recent.filter((t) => t.kind === "standard" && t.amount < 0);
    const pairs = findPossibleDuplicates(outflows, 2);
    const duplicatePairs = pairs.map(([a]) => {
      const t = outflows.find((x) => x.id === a)!;
      return { merchant: t.merchant, amount: t.amount, date: t.date };
    });
    const priceChanges = rules
      .filter((r) => r.amountChanged && r.lastMatched && r.lastMatched.date >= addDays(today, -30))
      .map((r) => ({ name: r.name, expected: r.amount, actual: r.lastMatched!.amount, date: r.lastMatched!.date }));
    const unusual = overview.insights
      .filter((i) => i.type === "large_transaction")
      .map((i) => {
        const id = i.key.split(":")[1];
        const t = recent.find((x) => x.id === id);
        return t ? { id, merchant: t.merchant, amount: t.amount, date: t.date } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const drafts = draftNotifications(
      { today, currency: prefs.currency, budget, forecast: overview.forecast, occurrences: overview.bills.concat(overview.overdue), goals: overview.goals, duplicatePairs, priceChanges, unusual },
      map,
    );
    await saveNotifications(db, userId, drafts, map);
  } catch (e) {
    log.warn("notify.evaluate_failed", errorFields(e));
  }
}
