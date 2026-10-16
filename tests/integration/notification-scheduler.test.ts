import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Database } from "@/server/db";
import { notifications, userPreferences, users } from "@/server/db/schema";
import { setMailer, type MailMessage } from "@/server/mail";
import { freshDb, makeUser } from "./helpers";
import { createGoal } from "@/server/services/goals";
import { listNotifications, updatePreference } from "@/server/services/notifications";
import { runNotificationSweep } from "@/server/services/notify-eval";

// The route resolves the shared client through getDb(); point it at this test's database.
const state = vi.hoisted(() => ({ db: undefined as Database | undefined }));
vi.mock("@/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/db")>()),
  getDb: async () => state.db!,
}));
const { GET, POST } = await import("@/app/api/cron/notifications/route");

let db: Database;
let close: () => Promise<void>;
let alice: string;
let bob: string;
let carol: string;
const sent: MailMessage[] = [];
const env = { ...process.env };

// 2026-03-20 13:00 in Pacific/Auckland (NZDT, UTC+13).
const MARCH_20_AFTERNOON = new Date("2026-03-20T00:00:00Z");

async function onboard(userId: string) {
  await db.update(userPreferences).set({ onboardingCompletedAt: new Date() }).where(eq(userPreferences.userId, userId));
}

beforeAll(async () => {
  ({ db, close } = await freshDb());
  state.db = db;
  setMailer({ send: async (m) => void sent.push(m) });
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  alice = await makeUser(db, "Alice");
  bob = await makeUser(db, "Bob");
  carol = await makeUser(db, "Carol"); // never finishes onboarding
  await onboard(alice);
  await onboard(bob);
  await createGoal(db, alice, { name: "Alice trip", kind: "holiday", targetAmount: 100_000, initialSaved: 60_000 }, "2026-03-01");
  await createGoal(db, bob, { name: "Bob car", kind: "car", targetAmount: 200_000, initialSaved: 160_000 }, "2026-03-01");
  await createGoal(db, carol, { name: "Carol laptop", kind: "laptop", targetAmount: 100_000, initialSaved: 100_000 }, "2026-03-01");
});
afterAll(async () => {
  setMailer(undefined);
  process.env = env;
  await close();
});

describe("notification sweep", () => {
  it("evaluates each onboarded user in batches and is idempotent", async () => {
    const first = await runNotificationSweep(db, { now: MARCH_20_AFTERNOON, batchSize: 1 });
    expect(first).toMatchObject({ users: 2, failed: 0, digests: 0 });
    expect(first.created).toBeGreaterThanOrEqual(2);
    const count = (await db.select().from(notifications)).length;

    const second = await runNotificationSweep(db, { now: MARCH_20_AFTERNOON, batchSize: 1 });
    expect(second).toMatchObject({ users: 2, created: 0, failed: 0 });
    expect((await db.select().from(notifications)).length).toBe(count);
  });

  it("keeps each user's notifications to themselves", async () => {
    const a = await listNotifications(db, alice);
    const b = await listNotifications(db, bob);
    expect(a.some((n) => n.title.includes("Alice trip"))).toBe(true);
    expect(b.some((n) => n.title.includes("Bob car"))).toBe(true);
    expect(a.every((n) => n.userId === alice && !n.title.includes("Bob"))).toBe(true);
    expect(b.every((n) => n.userId === bob && !n.title.includes("Alice"))).toBe(true);
    // Users who haven't finished onboarding are skipped entirely.
    expect(await listNotifications(db, carol)).toHaveLength(0);
  });
});

describe("cron route", () => {
  const req = (auth?: string) => new Request("http://localhost/api/cron/notifications", { method: "POST", headers: auth ? { authorization: auth } : {} });

  it("is disabled until CRON_SECRET is set", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer anything"))).status).toBe(503);
  });

  it("rejects missing or wrong bearer tokens", async () => {
    process.env.CRON_SECRET = "s3cret-cron-token";
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req("Bearer wrong"))).status).toBe(401);
    expect((await POST(req("Bearer s3cret-cron-token-extra"))).status).toBe(401);
    expect((await POST(req("s3cret-cron-token"))).status).toBe(401);
    expect((await POST(req("Bearer "))).status).toBe(401);
  });

  it("runs the sweep with the right token, repeatably", async () => {
    process.env.CRON_SECRET = "s3cret-cron-token";
    const before = (await db.select().from(notifications)).length;
    const res = await POST(req("Bearer s3cret-cron-token"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", users: 2, failed: 0 });
    const again = await GET(new Request("http://localhost/api/cron/notifications", { headers: { authorization: "Bearer s3cret-cron-token" } }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ created: 0 });
    expect((await db.select().from(notifications)).length).toBeGreaterThanOrEqual(before);
  });
});

describe("daily email digest", () => {
  beforeAll(async () => {
    process.env.RESEND_API_KEY = "test";
    process.env.EMAIL_FROM = "Ledger <no-reply@example.com>";
    await db.update(userPreferences).set({ emailDigest: true }).where(eq(userPreferences.userId, alice));
    await updatePreference(db, alice, "goal_milestone", { channels: ["in_app", "email"] });
    await updatePreference(db, bob, "goal_milestone", { channels: ["in_app", "email"] });
    sent.length = 0;
  });

  it("emails digest users once per local day, from 7am, and others immediately", async () => {
    const emailOf = async (id: string) => (await db.select({ email: users.email }).from(users).where(eq(users.id, id)))[0].email;
    const aliceEmail = await emailOf(alice);
    const bobEmail = await emailOf(bob);
    await createGoal(db, alice, { name: "Alice rainy day", kind: "emergency_fund", targetAmount: 50_000, initialSaved: 50_000 }, "2026-03-20");
    await createGoal(db, bob, { name: "Bob bike", kind: "custom", targetAmount: 50_000, initialSaved: 50_000 }, "2026-03-20");

    // 06:00 in Auckland: new alerts are stored, Bob is emailed at once, Alice's wait for the digest.
    const early = await runNotificationSweep(db, { now: new Date("2026-03-19T17:00:00Z") });
    expect(early).toMatchObject({ digests: 0, failed: 0 });
    expect(sent.some((m) => m.to === bobEmail && m.subject.includes("Bob bike"))).toBe(true);
    expect(sent.some((m) => m.to === aliceEmail)).toBe(false);

    // 08:00: one digest with every pending email-channel alert for Alice.
    const morning = await runNotificationSweep(db, { now: new Date("2026-03-19T19:00:00Z") });
    expect(morning).toMatchObject({ digests: 1, failed: 0 });
    const digest = sent.filter((m) => m.to === aliceEmail);
    expect(digest).toHaveLength(1);
    expect(digest[0].text).toContain("Alice rainy day");
    expect(digest[0].text).toContain("Alice trip");
    expect(digest[0].text).not.toContain("Bob");
    const emailed = (await listNotifications(db, alice)).filter((n) => n.type === "goal_milestone");
    expect(emailed.every((n) => n.deliveredVia.includes("email"))).toBe(true);

    // Later the same day: nothing more.
    expect(await runNotificationSweep(db, { now: new Date("2026-03-20T05:00:00Z") })).toMatchObject({ digests: 0 });
    expect(sent.filter((m) => m.to === aliceEmail)).toHaveLength(1);
  });

  it("sends nothing by email when email isn't configured", async () => {
    delete process.env.RESEND_API_KEY;
    await db.update(userPreferences).set({ lastDigestOn: null }).where(eq(userPreferences.userId, alice));
    await db.update(notifications).set({ deliveredVia: ["in_app"] }).where(eq(notifications.userId, alice));
    sent.length = 0;
    expect(await runNotificationSweep(db, { now: new Date("2026-03-21T19:00:00Z") })).toMatchObject({ digests: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });
});
