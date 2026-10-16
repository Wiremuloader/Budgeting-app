import type { Metadata } from "next";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listCategories } from "@/server/services/categories";
import { getPreferencesMap, NOTIFICATION_LABELS } from "@/server/services/notifications";
import { NOTIFICATION_TYPES } from "@/server/db/schema";
import { emailConfigured } from "@/server/mail";
import { aiConfigured } from "@/server/ai/assistant";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user, prefs } = await requireContext();
  const db = await getDb();
  const [cats, notif] = await Promise.all([listCategories(db, user.id, { includeArchived: true }), getPreferencesMap(db, user.id)]);
  const sp = await searchParams;
  return (
    <SettingsView
      tab={sp.tab ?? "general"}
      user={user}
      prefs={{
        country: prefs.country,
        currency: prefs.currency,
        timezone: prefs.timezone,
        budgetMethod: prefs.budgetMethod,
        budgetMode: prefs.budgetMode,
        safetyBuffer: prefs.safetyBuffer,
        lowBalanceThreshold: prefs.lowBalanceThreshold,
        aiEnabled: prefs.aiEnabled,
        incomeFrequency: prefs.incomeFrequency,
      }}
      categories={cats.map((c) => ({ id: c.id, name: c.name, group: c.group, archived: Boolean(c.archivedAt), rollover: c.rollover, parentId: c.parentId, alertThresholdBps: c.alertThresholdBps }))}
      notifications={NOTIFICATION_TYPES.map((t) => ({
        type: t,
        ...NOTIFICATION_LABELS[t],
        enabled: notif.get(t)?.enabled ?? true,
        thresholdValue: notif.get(t)?.threshold ?? null,
        email: notif.get(t)?.channels.includes("email") ?? false,
      }))}
      emailAvailable={emailConfigured()}
      aiAvailable={aiConfigured()}
    />
  );
}
