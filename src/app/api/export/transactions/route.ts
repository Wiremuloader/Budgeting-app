import { apiContext, csvResponse, limited, unauthorised } from "@/server/api";
import { exportTransactionsCsv } from "@/server/services/exports";
import { parseFilters } from "@/lib/transaction-filters";
import { audit } from "@/server/services/common";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await apiContext();
  if (!ctx) return unauthorised();
  const blocked = limited("export", ctx.userId, 20, 60_000);
  if (blocked) return blocked;
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries());
  const filters = parseFilters(sp);
  const csv = await exportTransactionsCsv(ctx.db, ctx.userId, { ...filters, page: undefined, pageSize: undefined }, { expandSplits: sp.splits === "rows" });
  await audit(ctx.db, ctx.userId, "export", "transactions", "export_csv");
  return csvResponse(csv, `ledger-transactions-${ctx.today}.csv`);
}
