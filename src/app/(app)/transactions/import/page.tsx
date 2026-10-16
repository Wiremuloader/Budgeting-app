import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listImportBatches } from "@/server/services/imports";
import { listAccounts } from "@/server/services/accounts";
import { PageHeader } from "@/components/page-header";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import transactions" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { user } = await requireContext();
  const db = await getDb();
  const [batches, accounts] = await Promise.all([listImportBatches(db, user.id), listAccounts(db, user.id)]);
  const sp = await searchParams;
  return (
    <>
      <Link href="/transactions" className="mb-2 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ChevronLeft className="size-4" /> Transactions
      </Link>
      <PageHeader title="Import from your bank" description="Upload a CSV export. You’ll see exactly what will be added before anything changes." />
      <ImportWizard
        accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        defaultAccountId={sp.account}
        batches={batches.map(({ b, accountName }) => ({
          id: b.id,
          accountName,
          fileName: b.fileName,
          createdAt: b.createdAt.toISOString(),
          imported: b.importedCount,
          duplicates: b.duplicateCount,
          errors: b.errorCount,
          status: b.status,
        }))}
      />
    </>
  );
}
