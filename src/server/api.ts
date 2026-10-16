import "server-only";
import { headers } from "next/headers";
import { getAuth } from "./auth";
import { getDb } from "./db";
import { getPreferences } from "./auth/session";
import { rateLimit } from "./rate-limit";
import { todayIn } from "@/domain/dates";

/** Authenticate a route handler request. Returns null when there is no valid session. */
export async function apiContext() {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const db = await getDb();
  const prefs = await getPreferences(session.user.id);
  return { userId: session.user.id, db, prefs, today: todayIn(prefs.timezone) };
}

export function unauthorised() {
  return Response.json({ error: "Unauthorised" }, { status: 401 });
}

export function limited(key: string, userId: string, max: number, windowMs: number): Response | null {
  const r = rateLimit(`${key}:${userId}`, max, windowMs);
  return r.ok ? null : Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(r.retryAfterSeconds) } });
}

export function csvResponse(body: string, filename: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
