import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getAuth } from "./index";
import { getDb } from "../db";
import { userPreferences } from "../db/schema";
import { ensureUserBootstrap } from "../services/bootstrap";
import { todayIn } from "@/domain/dates";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

/** Session for the current request (deduplicated per render). */
export const getSession = cache(async () => {
  const auth = await getAuth();
  return auth.api.getSession({ headers: await headers() });
});

/**
 * The single authorisation entry point for pages and server actions.
 * Redirects to sign-in when there's no valid session. All data access below this
 * point is scoped by the returned user id — never by ids supplied by the client alone.
 */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const u = session.user as typeof session.user & { twoFactorEnabled?: boolean | null };
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    emailVerified: u.emailVerified,
    twoFactorEnabled: Boolean(u.twoFactorEnabled),
  };
});

export type Preferences = typeof userPreferences.$inferSelect;

export const getPreferences = cache(async (userId: string): Promise<Preferences> => {
  const db = await getDb();
  let [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  if (!prefs) {
    await ensureUserBootstrap(db, userId);
    [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  }
  return prefs;
});

/** User + preferences + "today" in the user's timezone: the context most pages need. */
export const requireContext = cache(async () => {
  const user = await requireUser();
  const prefs = await getPreferences(user.id);
  const today = todayIn(prefs.timezone);
  return { user, prefs, today, currency: prefs.currency };
});
