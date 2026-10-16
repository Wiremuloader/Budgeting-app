import type { Metadata } from "next";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getBudgetMonth } from "@/server/services/budget";
import { listCategories } from "@/server/services/categories";
import { BudgetView } from "./budget-view";
import { isValidMonthKey, monthKey } from "@/domain/dates";

export const metadata: Metadata = { title: "Budget" };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { user, prefs, today, currency } = await requireContext();
  const sp = await searchParams;
  const month = sp.month && isValidMonthKey(sp.month) ? sp.month : monthKey(today);
  const db = await getDb();
  const [view, cats] = await Promise.all([getBudgetMonth(db, user.id, month, prefs, today), listCategories(db, user.id, { includeArchived: true })]);
  return (
    <BudgetView
      view={view}
      currency={currency}
      currentMonth={monthKey(today)}
      categories={cats.map((c) => ({ id: c.id, name: c.name, group: c.group, archived: Boolean(c.archivedAt), rollover: c.rollover, parentId: c.parentId, alertThresholdBps: c.alertThresholdBps }))}
    />
  );
}
