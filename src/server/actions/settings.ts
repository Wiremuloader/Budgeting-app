"use server";

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { run, zCents, zDate, zId, zMonth } from "./run";
import { categories, userPreferences, NOTIFICATION_TYPES } from "../db/schema";
import { createAccount } from "../services/accounts";
import { createRule } from "../services/recurring";
import { createGoal } from "../services/goals";
import { createDebtWithAccount } from "../services/debts";
import { applyAllocations } from "../services/budget";
import { audit } from "../services/common";
import { dismissNotification, listNotifications, markRead, unreadCount, updatePreference } from "../services/notifications";
import { commitImport, previewImport, undoImport } from "../services/imports";
import { askAssistant } from "../ai/assistant";
import { isValidTimeZone, monthKey } from "@/domain/dates";

/* ----------------------------------------------------------- preferences */

const prefsSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  locale: z.string().max(20).optional(),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone").optional(),
  budgetMethod: z.enum(["envelope", "flexible"]).optional(),
  budgetMode: z.enum(["guided", "manual"]).optional(),
  budgetStartMonth: zMonth.nullish(),
  incomeFrequency: z.enum(["weekly", "fortnightly", "monthly", "irregular"]).nullish(),
  safetyBuffer: zCents.refine((n) => n >= 0).optional(),
  lowBalanceThreshold: zCents.refine((n) => n >= 0).optional(),
  aiEnabled: z.boolean().optional(),
  priorities: z.array(z.string().max(40)).max(8).optional(),
});
export async function updatePreferencesAction(input: z.infer<typeof prefsSchema>) {
  return run(prefsSchema, input, async ({ db, user }, d) => {
    await db.update(userPreferences).set(d).where(eq(userPreferences.userId, user.id));
    await audit(db, user.id, "preferences", user.id, "update", d);
  });
}

export async function dismissChecklistAction() {
  return run(z.undefined(), undefined, async ({ db, user }) => {
    await db.update(userPreferences).set({ checklistDismissedAt: new Date() }).where(eq(userPreferences.userId, user.id));
  });
}

/* ------------------------------------------------------------ onboarding */

const onboarding = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone"),
  incomeFrequency: z.enum(["weekly", "fortnightly", "monthly", "irregular"]).nullable(),
  budgetMode: z.enum(["guided", "manual"]),
  budgetMethod: z.enum(["envelope", "flexible"]),
  safetyBuffer: zCents.refine((n) => n >= 0),
  priorities: z.array(z.string().max(40)).max(8),
  accounts: z.array(z.object({ name: z.string().trim().min(1).max(60), type: z.enum(["checking", "savings", "cash", "credit_card"]), balance: zCents })).max(10),
  incomes: z.array(z.object({ name: z.string().trim().min(1).max(60), amount: zCents.refine((n) => n > 0), frequency: z.enum(["weekly", "fortnightly", "monthly"]), nextDate: zDate })).max(5),
  fixed: z.array(z.object({ categoryKey: z.string().max(40), name: z.string().trim().min(1).max(60), amount: zCents.refine((n) => n > 0), frequency: z.enum(["weekly", "fortnightly", "monthly", "quarterly", "yearly"]), nextDate: zDate })).max(20),
  debts: z.array(z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(["credit_card", "personal_loan", "student_loan", "vehicle", "mortgage", "other"]), balanceOwed: zCents.refine((n) => n >= 0), aprBps: z.number().int().min(0).max(20000), minimumPayment: zCents.refine((n) => n >= 0) })).max(10),
  goals: z.array(z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(["emergency_fund", "car", "holiday", "laptop", "house_deposit", "education", "major_purchase", "custom"]), targetAmount: zCents.refine((n) => n > 0), targetDate: zDate.nullable(), plannedContribution: zCents.nullable(), cadence: z.enum(["weekly", "fortnightly", "monthly"]) })).max(10),
  /** User-reviewed starter budget (category template keys → amounts). Empty in manual mode. */
  allocations: z.array(z.object({ categoryKey: z.string().max(40), amount: zCents.refine((n) => n >= 0) })).max(40),
});

export async function completeOnboardingAction(input: z.infer<typeof onboarding>) {
  return run(onboarding, input, async ({ db, user, today }, d) => {
    await db
      .update(userPreferences)
      .set({
        country: d.country,
        currency: d.currency,
        timezone: d.timezone,
        incomeFrequency: d.incomeFrequency,
        budgetMode: d.budgetMode,
        budgetMethod: d.budgetMethod,
        safetyBuffer: d.safetyBuffer,
        priorities: d.priorities,
        budgetStartMonth: monthKey(today),
        onboardingCompletedAt: new Date(),
      })
      .where(eq(userPreferences.userId, user.id));

    const created: string[] = [];
    for (const a of d.accounts) {
      const acc = await createAccount(db, user.id, {
        name: a.name,
        type: a.type,
        currency: d.currency,
        openingBalance: a.type === "credit_card" ? -Math.abs(a.balance) : a.balance,
        openingDate: today,
      });
      created.push(acc.id);
    }
    const cats = await db.select().from(categories).where(and(eq(categories.userId, user.id)));
    const byKey = (k: string) => cats.find((c) => c.systemKey === k)?.id ?? null;
    const payAccount = created[0];
    if (payAccount) {
      for (const inc of d.incomes) {
        await createRule(db, user.id, { name: inc.name, kind: "income", accountId: payAccount, categoryId: byKey("salary"), amount: inc.amount, frequency: inc.frequency, anchorDate: inc.nextDate, source: "onboarding" }, today);
      }
      for (const f of d.fixed) {
        await createRule(
          db,
          user.id,
          { name: f.name, kind: "bill", accountId: payAccount, categoryId: byKey(f.categoryKey), amount: f.amount, amountVaries: f.categoryKey === "utilities", frequency: f.frequency, anchorDate: f.nextDate, source: "onboarding" },
          today,
        );
      }
    }
    for (const debt of d.debts) {
      await createDebtWithAccount(db, user.id, { ...debt, currency: d.currency, asOf: today, aprIsEstimate: true });
    }
    for (const g of d.goals) {
      await createGoal(db, user.id, { ...g }, today);
    }
    const allocations = d.allocations
      .map((a) => ({ categoryId: byKey(a.categoryKey), amount: a.amount }))
      .filter((a): a is { categoryId: string; amount: number } => Boolean(a.categoryId) && a.amount > 0);
    if (allocations.length) await applyAllocations(db, user.id, monthKey(today), allocations, "user");
    await audit(db, user.id, "onboarding", user.id, "complete", { accounts: d.accounts.length, incomes: d.incomes.length, bills: d.fixed.length, goals: d.goals.length, debts: d.debts.length });
  });
}

export async function skipOnboardingAction() {
  return run(z.undefined(), undefined, async ({ db, user, today }) => {
    await db.update(userPreferences).set({ onboardingCompletedAt: new Date(), budgetStartMonth: monthKey(today) }).where(eq(userPreferences.userId, user.id));
  });
}

/* --------------------------------------------------------- notifications */

export async function notificationsAction() {
  return run(
    z.undefined(),
    undefined,
    async ({ db, user }) => {
      const [items, unread] = await Promise.all([listNotifications(db, user.id, 30), unreadCount(db, user.id)]);
      return { unread, items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, severity: n.severity, read: Boolean(n.readAt), createdAt: n.createdAt.toISOString() })) };
    },
    { revalidate: [] },
  );
}
export async function markNotificationsReadAction(input: { id?: string }) {
  return run(z.object({ id: zId.optional() }), input, ({ db, user }, d) => markRead(db, user.id, d.id), { revalidate: [] });
}
export async function dismissNotificationAction(input: { id: string }) {
  return run(z.object({ id: zId }), input, ({ db, user }, d) => dismissNotification(db, user.id, d.id), { revalidate: [] });
}
const notifPref = z.object({ type: z.enum(NOTIFICATION_TYPES), enabled: z.boolean().optional(), threshold: z.number().int().min(0).max(1_000_000_000).nullish(), channels: z.array(z.enum(["in_app", "email"])).optional() });
export async function updateNotificationPreferenceAction(input: z.infer<typeof notifPref>) {
  return run(notifPref, input, ({ db, user }, d) => updatePreference(db, user.id, d.type, d));
}

/* --------------------------------------------------------------- imports */

const mapping = z.object({
  date: z.number().int().min(0),
  description: z.number().int().min(0),
  descriptionExtra: z.array(z.number().int().min(0)).max(5).optional(),
  amount: z.number().int().min(0).optional(),
  debit: z.number().int().min(0).optional(),
  credit: z.number().int().min(0).optional(),
  payee: z.number().int().min(0).optional(),
  reference: z.number().int().min(0).optional(),
  notes: z.number().int().min(0).optional(),
  category: z.number().int().min(0).optional(),
  externalId: z.number().int().min(0).optional(),
  dateFormat: z.enum(["YMD", "DMY", "MDY"]),
  invertAmounts: z.boolean().optional(),
});
const importSchema = z.object({ accountId: zId, text: z.string().max(2 * 1024 * 1024 + 1024), mapping: mapping.nullish() });
const LIMIT = { key: "import", max: 30, windowMs: 10 * 60_000 };

export async function previewImportAction(input: z.infer<typeof importSchema>) {
  return run(
    importSchema,
    input,
    async ({ db, user }, d) => {
      const p = await previewImport(db, user.id, d);
      // Send a bounded preview to the browser.
      return { ...p, rows: p.rows.slice(0, 500), totalRows: p.rows.length, previouslyImportedAt: p.previouslyImportedAt?.toISOString() ?? null };
    },
    { revalidate: [], limit: LIMIT },
  );
}

export async function commitImportAction(input: z.infer<typeof importSchema> & { fileName?: string; includePossibleDuplicates?: boolean; excludeRows?: number[] }) {
  return run(
    importSchema.extend({ mapping, fileName: z.string().max(200).optional(), includePossibleDuplicates: z.boolean().optional(), excludeRows: z.array(z.number().int()).max(10_000).optional() }),
    input,
    ({ db, user }, d) => commitImport(db, user.id, d),
    { limit: LIMIT },
  );
}

export async function undoImportAction(input: { batchId: string }) {
  return run(z.object({ batchId: zId }), input, ({ db, user }, d) => undoImport(db, user.id, d.batchId));
}

/* ------------------------------------------------------------- assistant */

const ask = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) })).min(1).max(30) });
export async function askAssistantAction(input: z.infer<typeof ask>) {
  return run(
    ask,
    input,
    async ({ db, user, prefs, today }, d) => {
      if (!prefs.aiEnabled) {
        const { offlineAnswer } = await import("../ai/fallback");
        return offlineAnswer({ db, userId: user.id, prefs, today }, d.messages.at(-1)!.content, "AI processing is turned off in Settings, so this answer comes directly from Ledger's calculations.");
      }
      return askAssistant({ db, userId: user.id, prefs, today }, d.messages);
    },
    { revalidate: [], limit: { key: "assistant", max: 20, windowMs: 60_000 } },
  );
}
