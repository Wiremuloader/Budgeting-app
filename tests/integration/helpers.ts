import { eq } from "drizzle-orm";
import { createMemoryDatabase, type Database } from "@/server/db";
import { categories, userPreferences, users } from "@/server/db/schema";
import { ensureUserBootstrap } from "@/server/services/bootstrap";
import type { Preferences } from "@/server/auth/session";

export async function freshDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  return createMemoryDatabase();
}

export async function makeUser(db: Database, name = "Aroha"): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, name, email: `${name.toLowerCase()}-${id.slice(0, 6)}@example.com`, emailVerified: true });
  await ensureUserBootstrap(db, id);
  return id;
}

export async function prefsOf(db: Database, userId: string): Promise<Preferences> {
  const [p] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return p;
}

export async function catId(db: Database, userId: string, systemKey: string): Promise<string> {
  const rows = await db.select().from(categories).where(eq(categories.userId, userId));
  const c = rows.find((r) => r.systemKey === systemKey);
  if (!c) throw new Error(`No category ${systemKey}`);
  return c.id;
}
