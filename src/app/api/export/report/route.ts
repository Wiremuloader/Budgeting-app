import { apiContext, csvResponse, limited, unauthorised } from "@/server/api";
import { categoryBreakdown, monthlySummaries } from "@/server/services/reports";
import { summaryCsv } from "@/server/services/exports";
import { isValidDate, monthKey, monthRange } from "@/domain/dates";
import { isUuid } from "@/server/services/common";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await apiContext();
  if (!ctx) return unauthorised();
  const blocked = limited("export", ctx.userId, 20, 60_000);
  if (blocked) return blocked;
  const sp = new URL(request.url).searchParams;
  const to = isValidDate(sp.get("to") ?? "") ? sp.get("to")! : ctx.today;
  const from = isValidDate(sp.get("from") ?? "") ? sp.get("from")! : `${to.slice(0, 4)}-01-01`;
  if (from > to) return Response.json({ error: "from must be before to" }, { status: 400 });
  const accountIds = sp.getAll("account").filter(isUuid);
  const filters = { accountIds: accountIds.length ? accountIds : undefined };
  const months = monthRange(monthKey(from), monthKey(to)).slice(-60);
  const [summaries, cats] = await Promise.all([monthlySummaries(ctx.db, ctx.userId, months, filters), categoryBreakdown(ctx.db, ctx.userId, { from, to }, filters)]);
  return csvResponse(summaryCsv(summaries, cats, ctx.prefs.currency), `ledger-report-${from}-to-${to}.csv`);
}
