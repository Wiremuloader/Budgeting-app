import type { Metadata } from "next";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { detectSuggestions, listRules, monthlyCommitments, occurrences } from "@/server/services/recurring";
import { RecurringView } from "./recurring-view";
import { addDays } from "@/domain/dates";

export const metadata: Metadata = { title: "Recurring" };

export default async function RecurringPage({ searchParams }: { searchParams: Promise<{ new?: string; tab?: string }> }) {
  const { user, today, currency } = await requireContext();
  const db = await getDb();
  const [rules, upcoming, suggestions] = await Promise.all([
    listRules(db, user.id, today),
    occurrences(db, user.id, addDays(today, -14), addDays(today, 45), today),
    detectSuggestions(db, user.id, today),
  ]);
  const sp = await searchParams;
  return (
    <RecurringView
      today={today}
      currency={currency}
      openNew={sp.new === "income" || sp.new === "bill" ? sp.new : null}
      initialTab={sp.tab ?? "upcoming"}
      rules={rules.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }))}
      upcoming={upcoming}
      suggestions={suggestions}
      commitments={monthlyCommitments(rules)}
    />
  );
}
