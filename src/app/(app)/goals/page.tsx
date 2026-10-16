import type { Metadata } from "next";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { goalEarmarkWarnings, listGoals } from "@/server/services/goals";
import { listAccounts } from "@/server/services/accounts";
import { GoalsView } from "./goals-view";

export const metadata: Metadata = { title: "Savings goals" };

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { user, today, currency } = await requireContext();
  const db = await getDb();
  const [goals, accounts] = await Promise.all([listGoals(db, user.id, today), listAccounts(db, user.id)]);
  const warnings = goalEarmarkWarnings(goals, accounts);
  const sp = await searchParams;
  return (
    <GoalsView
      today={today}
      currency={currency}
      openNew={sp.new === "1"}
      warnings={warnings}
      accounts={accounts.filter((a) => ["savings", "checking", "investment", "cash", "other_asset"].includes(a.type)).map((a) => ({ id: a.id, name: a.name, balance: a.balance }))}
      goals={goals.map((g) => ({ ...g, createdAt: g.createdAt.toISOString(), updatedAt: g.updatedAt.toISOString(), completedAt: g.completedAt?.toISOString() ?? null }))}
    />
  );
}
