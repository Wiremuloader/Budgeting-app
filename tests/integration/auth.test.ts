import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/server/db";
import { categories, financialAccounts, transactions, users, userPreferences } from "@/server/db/schema";
import { createAuthForTesting, type Auth } from "@/server/auth";
import { setMailer } from "@/server/mail";
import { freshDb } from "./helpers";
import { createAccount } from "@/server/services/accounts";
import { createTransaction } from "@/server/services/transactions";

let db: Database;
let close: () => Promise<void>;
let auth: Auth;
const sent: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.DISABLE_AUTH_RATE_LIMIT = "true";
  ({ db, close } = await freshDb());
  setMailer({ send: async (m) => void sent.push(m) });
  auth = createAuthForTesting(db);
});
afterAll(async () => {
  setMailer(undefined);
  await close();
});

const email = "kiri@example.com";
const password = "correct horse battery";

describe("authentication", () => {
  it("signs up, bootstraps the user and sends a verification email", async () => {
    const res = await auth.api.signUpEmail({ body: { email, password, name: "Kiri" } });
    expect(res.user.email).toBe(email);
    const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, res.user.id));
    expect(prefs.currency).toBe("NZD");
    const cats = await db.select().from(categories).where(eq(categories.userId, res.user.id));
    expect(cats.length).toBeGreaterThan(15);
    expect(sent.some((m) => m.to === email && /verify/i.test(m.subject))).toBe(true);
  });

  it("rejects short passwords and duplicate emails", async () => {
    await expect(auth.api.signUpEmail({ body: { email: "x@example.com", password: "short", name: "X" } })).rejects.toThrow();
    await expect(auth.api.signUpEmail({ body: { email, password, name: "Again" } })).rejects.toThrow();
  });

  it("signs in with the right password only", async () => {
    const ok = await auth.api.signInEmail({ body: { email, password } });
    expect(ok.token).toBeTruthy();
    await expect(auth.api.signInEmail({ body: { email, password: "wrong password!!" } })).rejects.toThrow();
  });

  it("stores only a password hash", async () => {
    const rows = await db.execute<{ password: string }>(`select password from auth_accounts where password is not null` as never);
    for (const r of rows.rows) expect(r.password).not.toContain(password);
  });

  it("sends a password reset link", async () => {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    expect(sent.some((m) => /reset/i.test(m.subject))).toBe(true);
  });

  it("deleting a user removes all of their financial data", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, email));
    const acc = await createAccount(db, u.id, { name: "Everyday", type: "checking", currency: "NZD", openingBalance: 1_000, openingDate: "2026-01-01" });
    await createTransaction(db, u.id, { accountId: acc.id, date: "2026-01-02", amount: -100, merchant: "x", categoryId: null });
    await db.delete(users).where(eq(users.id, u.id));
    expect(await db.select().from(financialAccounts).where(eq(financialAccounts.userId, u.id))).toHaveLength(0);
    expect(await db.select().from(transactions).where(eq(transactions.userId, u.id))).toHaveLength(0);
  });
});
