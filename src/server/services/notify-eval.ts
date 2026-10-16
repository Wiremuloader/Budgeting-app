import { and, asc, eq, gt, gte, isNotNull } from "drizzle-orm";
import type { Database } from "../db";
import { transactions, userPreferences } from "../db/schema";
import { draftNotifications, getPreferencesMap, saveNotifications, sendDailyDigest } from "./notifications";
import { getBudgetMonth } from "./budget";
import { buildForecast } from "./forecast";
import { listGoals } from "./goals";
import { buildInsights } from "./insights";
import { listRules, occurrences } from "./recurring";
import type { Preferences } from "../auth/session";
import { emailConfigured } from "../mail";
import { findPossibleDuplicates } from "@/domain/duplicates";
import { addDays, monthKey, todayIn, type ISODate } from "@/domain/dates";
import { log, errorFields } from "../log";

/**
 * Compute every notification input for one user and store whatever is new.
 * Used by both the Overview page and the background scheduler; the dedupe key on
 * each notification makes repeated runs harmless. Returns the number of new items.
 */
export async function evaluateUserNotifications(db: Database, userId: string, prefs: Preferences, today: ISODate): Promise<number> {
  const [map, budget, forecast, goals, upcoming, rules, recent] = await Promise.all([
    getPreferencesMap(db, userId),
    getBudgetMonth(db, userId, monthKey(today), prefs, today),
    buildForecast(db, userId, today, 30, { currency: prefs.currency, safetyBuffer: prefs.safetyBuffer, lowBalanceThreshold: prefs.lowBalanceThreshold }),
    listGoals(db, userId, today),
    occurrences(db, userId, addDays(today, -7), addDays(today, 30), today),
    listRules(db, userId, today),
    db
      .select({ id: transactions.id, accountId: transactions.accountId, date: transactions.date, amount: transactions.amount, merchantKey: transactions.merchantKey, merchant: transactions.merchant, externalId: transactions.externalId, kind: transactions.kind })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), gte(transactions.date, addDays(today, -14)))),
  ]);
  const insights = await buildInsights(
    db,
    userId,
    { today, currency: prefs.currency, budget, forecast, occurrences: upcoming, goals, lowBalanceThreshold: prefs.lowBalanceThreshold },
    100,
  );

  const outflows = recent.filter((t) => t.kind === "standard" && t.amount < 0);
  const pairs = findPossibleDuplicates(outflows, 2);
  const duplicatePairs = pairs.map(([a]) => {
    const t = outflows.find((x) => x.id === a)!;
    return { merchant: t.merchant, amount: t.amount, date: t.date };
  });
  const priceChanges = rules
    .filter((r) => r.amountChanged && r.lastMatched && r.lastMatched.date >= addDays(today, -30))
    .map((r) => ({ name: r.name, expected: r.amount, actual: r.lastMatched!.amount, date: r.lastMatched!.date }));
  const unusual = insights
    .filter((i) => i.type === "large_transaction")
    .map((i) => {
      const id = i.key.split(":")[1];
      const t = recent.find((x) => x.id === id);
      return t ? { id, merchant: t.merchant, amount: t.amount, date: t.date } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const activeGoals = goals.filter((g) => g.status === "active" || g.status === "paused");

  const drafts = draftNotifications(
    { today, currency: prefs.currency, budget, forecast, occurrences: upcoming, goals: activeGoals, duplicatePairs, priceChanges, unusual },
    map,
  );
  return saveNotifications(db, userId, drafts, map, { emailDigest: prefs.emailDigest && emailConfigured() });
}

const lastRun = new Map<string, number>();

/**
 * Overview-page trigger: runs at most every 10 minutes per user per process.
 * Failures never break the page.
 */
export async function evaluateNotifications(db: Database, userId: string, prefs: Preferences, today: ISODate): Promise<void> {
  const now = Date.now();
  if ((lastRun.get(userId) ?? 0) > now - 10 * 60_000) return;
  lastRun.set(userId, now);
  try {
    await evaluateUserNotifications(db, userId, prefs, today);
  } catch (e) {
    log.warn("notify.evaluate_failed", errorFields(e));
  }
}

/** Local hour from which the daily email digest may go out. */
export const DIGEST_HOUR = 7;

function localHour(timeZone: string, now: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
}

export interface SweepResult {
  users: number;
  created: number;
  digests: number;
  failed: number;
}

/**
 * Background scheduler entry point: evaluate every onboarded user, in batches, and send
 * daily digests that are due. One user's failure is logged and doesn't stop the sweep.
 */
export async function runNotificationSweep(db: Database, { now = new Date(), batchSize = 100 }: { now?: Date; batchSize?: number } = {}): Promise<SweepResult> {
  const result: SweepResult = { users: 0, created: 0, digests: 0, failed: 0 };
  const digestsOn = emailConfigured();
  let after = "";
  for (;;) {
    const batch = await db
      .select()
      .from(userPreferences)
      .where(and(isNotNull(userPreferences.onboardingCompletedAt), gt(userPreferences.userId, after)))
      .orderBy(asc(userPreferences.userId))
      .limit(batchSize);
    for (const prefs of batch) {
      result.users++;
      const today = todayIn(prefs.timezone, now);
      try {
        result.created += await evaluateUserNotifications(db, prefs.userId, prefs, today);
        if (digestsOn && prefs.emailDigest && localHour(prefs.timezone, now) >= DIGEST_HOUR) {
          if ((await sendDailyDigest(db, prefs.userId, today)) > 0) result.digests++;
        }
      } catch (e) {
        result.failed++;
        log.warn("notify.sweep_user_failed", { userId: prefs.userId, ...errorFields(e) });
      }
    }
    if (batch.length < batchSize) break;
    after = batch[batch.length - 1].userId;
  }
  log.info("notify.sweep_done", { ...result });
  return result;
}
