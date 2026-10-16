import type { Metadata } from "next";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { accountTotals, listAccounts } from "@/server/services/accounts";
import { availableProviders } from "@/server/banking/provider";
import { AccountsView } from "./accounts-view";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { user, currency, today } = await requireContext();
  const db = await getDb();
  const accounts = await listAccounts(db, user.id, { includeArchived: true });
  const totals = accountTotals(accounts, currency);
  const sp = await searchParams;
  return (
    <AccountsView
      currency={currency}
      today={today}
      openNew={sp.new === "1"}
      totals={totals}
      providers={availableProviders().map((p) => ({ id: p.id, name: p.displayName }))}
      accounts={accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        institution: a.institution,
        mask: a.mask,
        spendable: a.spendable,
        includeInNetWorth: a.includeInNetWorth,
        onBudget: a.onBudget,
        archived: Boolean(a.archivedAt),
        balance: a.balance,
        clearedBalance: a.clearedBalance,
        pendingBalance: a.pendingBalance,
        transactionCount: a.transactionCount,
        lastTransactionDate: a.lastTransactionDate,
        lastReconciledAt: a.lastReconciledAt?.toISOString() ?? null,
        isSample: a.isSample,
        hasDebtProfile: a.hasDebtProfile,
        connected: Boolean(a.connectionId),
      }))}
    />
  );
}
