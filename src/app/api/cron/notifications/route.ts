import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db";
import { runNotificationSweep } from "@/server/services/notify-eval";
import { log, errorFields } from "@/server/log";

export const dynamic = "force-dynamic";

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>` (hashing first hides the length). */
function authorised(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(token), digest(secret)) && token.length > 0;
}

/**
 * Background notification sweep for every user. Call from a scheduler (host cron,
 * Vercel Cron, a Kubernetes CronJob…) with the shared secret; safe to call repeatedly.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.warn("cron.not_configured");
    return Response.json({ error: "Scheduler is not configured" }, { status: 503 });
  }
  if (!authorised(request, secret)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const result = await runNotificationSweep(await getDb());
    return Response.json({ status: "ok", ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    log.error("cron.notifications_failed", errorFields(e));
    return Response.json({ status: "error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
