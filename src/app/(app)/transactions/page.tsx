import type { Metadata } from "next";
import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listTransactions } from "@/server/services/transactions";
import { parseFilters } from "@/lib/transaction-filters";
import { transferCandidates } from "@/server/services/imports";
import { PageHeader } from "@/components/page-header";
import { buttonStyles } from "@/components/ui/primitives";
import { TransactionsView } from "./transactions-view";
import { addDays } from "@/domain/dates";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, today, currency } = await requireContext();
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const db = await getDb();
  const [result, candidates] = await Promise.all([listTransactions(db, user.id, filters), transferCandidates(db, user.id, addDays(today, -90), 5)]);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every dollar in and out. Transfers between your accounts are kept separate from income and spending."
        actions={
          <>
            <Link href="/transactions/import" className={buttonStyles({ size: "sm" })}>
              <Upload /> Import CSV
            </Link>
            <a href={`/api/export/transactions${qs ? `?${qs}` : ""}`} className={buttonStyles({ size: "sm" })}>
              <Download /> Export CSV
            </a>
          </>
        }
      />
      <TransactionsView
        currency={currency}
        filters={filters}
        result={{
          ...result,
          items: result.items.map((t) => ({ ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() })),
        }}
        candidates={candidates}
      />
    </>
  );
}
