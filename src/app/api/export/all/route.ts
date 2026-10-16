import { apiContext, limited, unauthorised } from "@/server/api";
import { exportAllData } from "@/server/services/exports";
import { audit } from "@/server/services/common";

export const dynamic = "force-dynamic";

/** Full personal data export (JSON). */
export async function GET() {
  const ctx = await apiContext();
  if (!ctx) return unauthorised();
  const blocked = limited("export_all", ctx.userId, 5, 60 * 60_000);
  if (blocked) return blocked;
  const data = await exportAllData(ctx.db, ctx.userId);
  await audit(ctx.db, ctx.userId, "export", "all", "export_json");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ledger-export-${ctx.today}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
