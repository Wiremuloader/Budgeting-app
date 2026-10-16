import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { Database, Queryable } from "../db";
import { notificationPreferences, notifications, users, NOTIFICATION_TYPES } from "../db/schema";
import type { BudgetMonthView } from "./budget";
import type { ForecastBundle } from "./forecast";
import type { GoalView } from "./goals";
import type { Occurrence } from "./recurring";
import { getMailer, emailConfigured } from "../mail";
import { log, errorFields } from "../log";
import { formatMoney } from "@/domain/money";
import { addDays, diffDays, formatDisplayDate, monthKey, type ISODate } from "@/domain/dates";

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export type NotificationRow = typeof notifications.$inferSelect;
export type PreferenceRow = typeof notificationPreferences.$inferSelect;

export interface DraftNotification {
  type: NotificationType;
  severity: "info" | "warning" | "positive";
  title: string;
  body: string;
  href?: string;
  dedupeKey: string;
}

/* ---------------------------------------------------------------- channels */

export interface DeliveryChannel {
  id: "in_app" | "email" | "push";
  available(): boolean;
  deliver(userId: string, email: string, n: DraftNotification): Promise<void>;
}

/** In-app delivery is the notification row itself. */
const inApp: DeliveryChannel = { id: "in_app", available: () => true, deliver: async () => {} };

const email: DeliveryChannel = {
  id: "email",
  available: emailConfigured,
  deliver: async (_userId, to, n) => {
    await getMailer().send({ to, subject: `Ledger: ${n.title}`, text: `${n.body}\n\nOpen Ledger to see details.` });
  },
};

/** Push is designed for but not implemented: no push provider is configured. */
const push: DeliveryChannel = { id: "push", available: () => false, deliver: async () => {} };

export const CHANNELS = [inApp, email, push];

/* ----------------------------------------------------------------- rules */

export const NOTIFICATION_LABELS: Record<NotificationType, { label: string; description: string; threshold?: "bps" | "days" | "cents" }> = {
  budget_approaching: { label: "Approaching a budget limit", description: "When a category reaches its alert threshold.", threshold: "bps" },
  budget_exceeded: { label: "Budget exceeded", description: "When spending goes over a category's budget." },
  bill_upcoming: { label: "Upcoming bills", description: "Before a confirmed bill is due.", threshold: "days" },
  low_balance: { label: "Low balance forecast", description: "When your spendable balance is forecast to drop below your threshold." },
  unusual_transaction: { label: "Unusually large transactions", description: "When a purchase is far above your typical amount for its category." },
  goal_milestone: { label: "Savings milestones", description: "When a goal reaches 25%, 50%, 75% or 100%." },
  income_missing: { label: "Missing expected income", description: "When expected pay hasn't been recorded a couple of days after it was due." },
  duplicate_charge: { label: "Possible duplicate charges", description: "When the same amount from the same merchant appears twice within two days." },
  recurring_changed: { label: "Recurring payment changes", description: "When a subscription or bill charges a different amount than expected." },
};

export async function getPreferencesMap(db: Queryable, userId: string): Promise<Map<NotificationType, PreferenceRow>> {
  const rows = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  return new Map(rows.map((r) => [r.type, r]));
}

export interface EvaluationContext {
  today: ISODate;
  currency: string;
  budget: BudgetMonthView;
  forecast: ForecastBundle;
  occurrences: Occurrence[];
  goals: GoalView[];
  duplicatePairs: { merchant: string; amount: number; date: ISODate }[];
  priceChanges: { name: string; expected: number; actual: number; date: ISODate }[];
  unusual: { id: string; merchant: string; amount: number; date: ISODate }[];
}

export function draftNotifications(ctx: EvaluationContext, prefs: Map<NotificationType, PreferenceRow>): DraftNotification[] {
  const on = (t: NotificationType) => prefs.get(t)?.enabled ?? true;
  const fmt = (c: number) => formatMoney(c, ctx.currency);
  const month = monthKey(ctx.today);
  const out: DraftNotification[] = [];

  if (ctx.budget.isCurrent) {
    for (const c of ctx.budget.categories) {
      const budgeted = c.assigned + c.carryIn;
      if (budgeted <= 0) continue;
      if (c.spent > budgeted && on("budget_exceeded")) {
        out.push({
          type: "budget_exceeded",
          severity: "warning",
          title: `${c.name} is over budget`,
          body: `${fmt(c.spent)} spent of ${fmt(budgeted)} this month.`,
          href: "/budget",
          dedupeKey: `budget_exceeded:${c.id}:${month}`,
        });
      } else if (on("budget_approaching")) {
        const threshold = Number(prefs.get("budget_approaching")?.threshold ?? c.alertThresholdBps);
        if ((c.usedBps ?? 0) >= Math.min(threshold, c.alertThresholdBps) && c.spent <= budgeted) {
          out.push({
            type: "budget_approaching",
            severity: "info",
            title: `${c.name}: ${Math.round((c.usedBps ?? 0) / 100)}% used`,
            body: `${fmt(Math.max(budgeted - c.spent, 0))} left for the rest of the month.`,
            href: "/budget",
            dedupeKey: `budget_approaching:${c.id}:${month}`,
          });
        }
      }
    }
  }

  if (on("bill_upcoming")) {
    const days = Number(prefs.get("bill_upcoming")?.threshold ?? 3);
    for (const o of ctx.occurrences) {
      if (o.amount >= 0 || o.status !== "upcoming") continue;
      const until = diffDays(ctx.today, o.date);
      if (until < 0 || until > days) continue;
      out.push({
        type: "bill_upcoming",
        severity: "info",
        title: `${o.name} due ${until === 0 ? "today" : until === 1 ? "tomorrow" : formatDisplayDate(o.date, { weekday: true })}`,
        body: `Expected ${fmt(-o.amount)}.`,
        href: "/recurring",
        dedupeKey: `bill_upcoming:${o.ruleId}:${o.date}`,
      });
    }
  }

  if (on("income_missing")) {
    for (const o of ctx.occurrences) {
      if (o.kind !== "income" || (o.status !== "late" && o.status !== "missed")) continue;
      if (diffDays(o.date, ctx.today) < 2 || o.date < addDays(ctx.today, -10)) continue;
      out.push({
        type: "income_missing",
        severity: "warning",
        title: `${o.name} hasn't been recorded`,
        body: `It was expected on ${formatDisplayDate(o.date, { weekday: true })}.`,
        href: "/recurring",
        dedupeKey: `income_missing:${o.ruleId}:${o.date}`,
      });
    }
  }

  if (on("low_balance") && ctx.forecast.forecast.shortfall?.scenario === "expected") {
    const s = ctx.forecast.forecast.shortfall;
    out.push({
      type: "low_balance",
      severity: "warning",
      title: "Low balance forecast",
      body: `Your spendable balance is forecast to fall below your threshold around ${formatDisplayDate(s.date, { weekday: true })}. This is an estimate.`,
      href: "/reports?tab=forecast",
      dedupeKey: `low_balance:${s.date}`,
    });
  }

  if (on("goal_milestone")) {
    for (const g of ctx.goals) {
      const pct = g.progress.progressBps;
      const milestone = [10_000, 7_500, 5_000, 2_500].find((m) => pct >= m);
      if (!milestone) continue;
      out.push({
        type: "goal_milestone",
        severity: "positive",
        title: milestone === 10_000 ? `You reached "${g.name}"` : `"${g.name}" is ${milestone / 100}% there`,
        body: `${fmt(g.savedAmount)} saved of ${fmt(g.targetAmount)}.`,
        href: "/goals",
        dedupeKey: `goal_milestone:${g.id}:${milestone}`,
      });
    }
  }

  if (on("duplicate_charge")) {
    for (const d of ctx.duplicatePairs) {
      out.push({
        type: "duplicate_charge",
        severity: "warning",
        title: `Possible duplicate: ${d.merchant}`,
        body: `Two charges of ${fmt(-d.amount)} close together around ${formatDisplayDate(d.date)}. Check whether one should be removed.`,
        href: `/transactions?q=${encodeURIComponent(d.merchant)}`,
        dedupeKey: `duplicate_charge:${d.merchant}:${d.amount}:${d.date}`,
      });
    }
  }

  if (on("recurring_changed")) {
    for (const p of ctx.priceChanges) {
      out.push({
        type: "recurring_changed",
        severity: "info",
        title: `${p.name} changed price`,
        body: `Charged ${fmt(Math.abs(p.actual))} instead of the expected ${fmt(Math.abs(p.expected))}.`,
        href: "/recurring",
        dedupeKey: `recurring_changed:${p.name}:${p.date}`,
      });
    }
  }

  if (on("unusual_transaction")) {
    for (const u of ctx.unusual) {
      out.push({
        type: "unusual_transaction",
        severity: "info",
        title: `Large purchase at ${u.merchant}`,
        body: `${fmt(-u.amount)} on ${formatDisplayDate(u.date)} is well above your usual for this category.`,
        href: `/transactions?q=${encodeURIComponent(u.merchant)}`,
        dedupeKey: `unusual_transaction:${u.id}`,
      });
    }
  }
  return out;
}

/** Store new notifications (dedupe key makes this idempotent) and deliver to enabled channels. */
export async function saveNotifications(db: Database, userId: string, drafts: DraftNotification[], prefs: Map<NotificationType, PreferenceRow>, maxPerRun = 5) {
  if (!drafts.length) return 0;
  // Anti-spam: no more than `maxPerRun` new items per evaluation and 15 per day.
  const [{ today }] = await db
    .select({ today: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), gte(notifications.createdAt, new Date(Date.now() - 86_400_000))));
  const budget = Math.max(Math.min(maxPerRun, 15 - today), 0);
  if (!budget) return 0;
  const inserted = await db
    .insert(notifications)
    .values(drafts.map((d) => ({ userId, type: d.type, severity: d.severity, title: d.title, body: d.body, href: d.href ?? null, dedupeKey: d.dedupeKey })))
    .onConflictDoNothing()
    .returning();
  const fresh = inserted.slice(0, budget);
  if (inserted.length > budget) {
    // Over the cap: keep the rows (so they aren't re-created) but mark the overflow read.
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(sql`${notifications.id} in (${sql.join(inserted.slice(budget).map((n) => sql`${n.id}`), sql`, `)})`);
  }
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  for (const n of fresh) {
    const channels = prefs.get(n.type)?.channels ?? ["in_app"];
    for (const ch of CHANNELS) {
      if (ch.id === "in_app" || !channels.includes(ch.id) || !ch.available()) continue;
      try {
        await ch.deliver(userId, u.email, { ...n, href: n.href ?? undefined, severity: n.severity });
        await db.update(notifications).set({ deliveredVia: sql`array_append(${notifications.deliveredVia}, ${ch.id})` }).where(eq(notifications.id, n.id));
      } catch (e) {
        log.warn("notify.delivery_failed", { channel: ch.id, ...errorFields(e) });
      }
    }
  }
  return fresh.length;
}

export async function listNotifications(db: Queryable, userId: string, limit = 30) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.dismissedAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(db: Queryable, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), isNull(notifications.dismissedAt)));
  return r.n;
}

export async function markRead(db: Database, userId: string, id?: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
}

export async function dismissNotification(db: Database, userId: string, id: string) {
  await db
    .update(notifications)
    .set({ dismissedAt: new Date(), readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.id, id)));
}

export async function updatePreference(
  db: Database,
  userId: string,
  type: NotificationType,
  patch: { enabled?: boolean; threshold?: number | null; channels?: string[] },
) {
  if (!NOTIFICATION_TYPES.includes(type)) throw new Error("Unknown notification type");
  const channels = patch.channels?.filter((c) => c === "in_app" || c === "email");
  await db
    .insert(notificationPreferences)
    .values({ userId, type, enabled: patch.enabled ?? true, threshold: patch.threshold ?? null, channels: channels ?? ["in_app"] })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.type],
      set: {
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.threshold !== undefined ? { threshold: patch.threshold } : {}),
        ...(channels ? { channels: channels.includes("in_app") ? channels : ["in_app", ...channels] } : {}),
      },
    });
}
