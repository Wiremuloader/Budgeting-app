import type { Metadata } from "next";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listDebts } from "@/server/services/debts";
import { listAccounts } from "@/server/services/accounts";
import { DebtView } from "./debt-view";

export const metadata: Metadata = { title: "Debt" };

export default async function DebtPage() {
  const { user, today, currency } = await requireContext();
  const db = await getDb();
  const [debts, accounts] = await Promise.all([listDebts(db, user.id, today), listAccounts(db, user.id)]);
  const unlinked = accounts.filter((a) => ["credit_card", "loan", "other_liability"].includes(a.type) && !a.hasDebtProfile).map((a) => ({ id: a.id, name: a.name, balance: a.balance }));
  return (
    <DebtView
      today={today}
      currency={currency}
      unlinked={unlinked}
      debts={debts.map((d) => ({ ...d, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() }))}
    />
  );
}
