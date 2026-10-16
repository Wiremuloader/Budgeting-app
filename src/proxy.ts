import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic routing only: send visitors without a session cookie to sign-in.
 * Real authorisation happens on the server for every page, action and API route
 * (requireUser + per-user query scoping) — never here.
 */
// /api/cron authenticates with CRON_SECRET in the route itself.
const PUBLIC = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/api/auth", "/api/health", "/api/cron"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const cookie = getSessionCookie(request, { cookiePrefix: "ledger" });
  if (!cookie) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    const url = new URL("/sign-in", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
