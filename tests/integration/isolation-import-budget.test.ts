import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/server/db";
import { catId, freshDb, makeUser, prefsOf } from "./helpers";
import { createAccount, listAccounts, updateAccount } from "@/server/services/accounts";
import { createTransaction, createTransfer, deleteTransaction, listTransactions, updateTransaction, bulkUpdate } from "@/server/services/transactions";
import { commitImport, previewImport, transferCandidates, undoImport } from "@/server/services/imports";
import { applyAllocations, getBudgetMonth, moveMoney, setAssigned, setBudgetMethod } from "@/server/services/budget";
import { createRule, occurrences, detectSuggestions, confirmSuggestion } from "@/server/services/recurring";
import { createGoal, listGoals } from "@/server/services/goals";
import { exportAllData, exportTransactionsCsv } from "@/server/services/exports";
import { draftNotifications, getPreferencesMap, saveNotifications, listNotifications } from "@/server/services/notifications";
import { buildForecast } from "@/server/services/forecast";
import { getOverview } from "@/server/services/overview";
import { offlineAnswer } from "@/server/ai/fallback";
import { toolByName } from "@/server/ai/tools";
import { parseCsv } from "@/domain/csv";

let db: Database;
let close: () => Promise<void>;
let alice: string;
let bob: string;
let aliceChecking: string;

beforeAll(async () => {
  ({ db, close } = await freshDb());
  alice = await makeUser(db, "Alice");
  bob = await makeUser(db, "Bob");
  aliceChecking = (await createAccount(db, alice, { name: "Everyday", type: "checking", currency: "NZD", openingBalance: 100_000, openingDate: "2026-01-01" })).id;
});
afterAll(() => close());

describe("user data isolation", () => {
  it("one user can't read, change or delete another user's records", async () => {
    const t = await createTransaction(db, alice, { accountId: aliceChecking, date: "2026-02-01", amount: -1_000, merchant: "Secret", categoryId: null });
    const bobAccount = (await createAccount(db, bob, { name: "Bob's", type: "checking", currency: "NZD", openingBalance: 0, openingDate: "2026-01-01" })).id;
    expect((await listTransactions(db, bob, { q: "Secret" })).total).toBe(0);
    expect((await listAccounts(db, bob)).map((a) => a.id)).not.toContain(aliceChecking);
    await expect(updateTransaction(db, bob, t.id, { amount: -1 })).rejects.toThrow(/not found/);
    await expect(deleteTransaction(db, bob, t.id)).rejects.toThrow(/not found/);
    await expect(updateAccount(db, bob, aliceChecking, { name: "pwned" })).rejects.toThrow(/not found/);
    // Bob can't post into Alice's account, or use Alice's category, or transfer from her account.
    await expect(createTransaction(db, bob, { accountId: aliceChecking, date: "2026-02-01", amount: -1, merchant: "x", categoryId: null })).rejects.toThrow(/not found/);
    await expect(createTransaction(db, bob, { accountId: bobAccount, date: "2026-02-01", amount: -1, merchant: "x", categoryId: await catId(db, alice, "groceries") })).rejects.toThrow(/not found/);
    await expect(createTransfer(db, bob, { fromAccountId: aliceChecking, toAccountId: bobAccount, amount: 100, date: "2026-02-01" })).rejects.toThrow(/not found/);
    // Bulk edits silently skip ids the user doesn't own.
    expect((await bulkUpdate(db, bob, [t.id], { reviewed: true })).updated).toBe(0);
    await expect(previewImport(db, bob, { accountId: aliceChecking, text: "Date,Description,Amount\n2026-01-01,x,1" })).rejects.toThrow(/not found/);
    const exported = await exportAllData(db, bob);
    expect(JSON.stringify(exported)).not.toContain("Secret");
  });
});

const CSV = `Date,Description,Amount,Unique Id
03/02/2026,COUNTDOWN PONSONBY,-82.15,a1
04/02/2026,ACME LTD SALARY,"2,350.00",a2
05/02/2026,Z ENERGY NEWMARKET,-70.00,a3
05/02/2026,Z ENERGY NEWMARKET,-70.00,a4
bad-date,Broken row,12.00,a5
`;

describe("CSV import", () => {
  it("previews, imports, is idempotent on re-import, and can be undone", async () => {
    const p = await previewImport(db, alice, { accountId: aliceChecking, text: CSV });
    expect(p.mapping?.dateFormat).toBe("DMY");
    expect(p.stats).toEqual({ new: 4, duplicate: 0, possible_duplicate: 0, error: 1 });
    const r = await commitImport(db, alice, { accountId: aliceChecking, text: CSV, fileName: "feb.csv", mapping: p.mapping! });
    expect(r.imported).toBe(4);
    const again = await previewImport(db, alice, { accountId: aliceChecking, text: CSV });
    expect(again.previouslyImportedAt).not.toBeNull();
    expect(again.stats.duplicate).toBe(4);
    const r2 = await commitImport(db, alice, { accountId: aliceChecking, text: CSV, mapping: p.mapping! });
    expect(r2.imported).toBe(0);
    expect((await listTransactions(db, alice, { q: "Z Energy" })).total).toBe(2); // two genuine identical rows kept
    const undone = await undoImport(db, alice, r.batchId);
    expect(undone.removed).toBe(4);
    expect((await listTransactions(db, alice, { q: "Countdown" })).total).toBe(0);
  });

  it("flags a manually entered transaction as a possible duplicate", async () => {
    await createTransaction(db, alice, { accountId: aliceChecking, date: "2026-02-10", amount: -4_500, merchant: "Cafe Hanoi", categoryId: null });
    const p = await previewImport(db, alice, { accountId: aliceChecking, text: "Date,Description,Amount\n2026-02-11,CAFE HANOI AUCKLAND,-45.00\n" });
    expect(p.rows[0].status).toBe("possible_duplicate");
  });

  it("rejects bad mappings and oversized files", async () => {
    await expect(previewImport(db, alice, { accountId: aliceChecking, text: CSV, mapping: { date: 99, description: 1, amount: 2, dateFormat: "DMY" } })).rejects.toThrow(/mapping/);
    await expect(previewImport(db, alice, { accountId: aliceChecking, text: "x".repeat(3 * 1024 * 1024) })).rejects.toThrow(/2 MB/);
  });

  it("suggests linking card payments imported from both sides", async () => {
    const card = (await createAccount(db, alice, { name: "Visa", type: "credit_card", currency: "NZD", openingBalance: 0, openingDate: "2026-01-01" })).id;
    await createTransaction(db, alice, { accountId: aliceChecking, date: "2026-02-20", amount: -30_000, merchant: "VISA PAYMENT", categoryId: null });
    await createTransaction(db, alice, { accountId: card, date: "2026-02-21", amount: 30_000, merchant: "PAYMENT THANK YOU", categoryId: null });
    const c = await transferCandidates(db, alice, "2026-02-01");
    expect(c.some((p) => p.outflow.amount === -30_000 && p.inflow.accountId === card)).toBe(true);
  });
});

describe("budgets", () => {
  let user: string;
  let acct: string;
  beforeAll(async () => {
    user = await makeUser(db, "Budgeter");
    acct = (await createAccount(db, user, { name: "Everyday", type: "checking", currency: "NZD", openingBalance: 50_000, openingDate: "2026-03-01" })).id;
    await createTransaction(db, user, { accountId: acct, date: "2026-03-01", amount: 300_000, merchant: "Employer", categoryId: await catId(db, user, "salary") });
    await createTransaction(db, user, { accountId: acct, date: "2026-03-05", amount: -45_000, merchant: "Countdown", categoryId: await catId(db, user, "groceries") });
    await createTransaction(db, user, { accountId: acct, date: "2026-03-06", amount: -12_000, merchant: "Pizza", categoryId: await catId(db, user, "restaurants") });
  });

  it("envelope: ready to assign = starting cash + income − assigned; overspending is explicit", async () => {
    const prefs = { budgetMethod: "envelope" as const, budgetStartMonth: "2026-03" };
    await setAssigned(db, user, "2026-03", await catId(db, user, "groceries"), 60_000);
    await setAssigned(db, user, "2026-03", await catId(db, user, "restaurants"), 10_000);
    const b = await getBudgetMonth(db, user, "2026-03", prefs, "2026-03-15");
    // Opening 50 000 (before March? no — dated 1 March, so it is a March adjustment) + 300 000 income − 70 000 assigned
    expect(b.readyToAssign).toBe(280_000);
    const dining = b.categories.find((c) => c.name.startsWith("Restaurants"))!;
    expect(dining.available).toBe(-2_000);
    expect(dining.status).toBe("over");
    expect(b.overspentTotal).toBe(2_000);
    // Moving money fixes it without changing the total assigned.
    await moveMoney(db, user, "2026-03", await catId(db, user, "groceries"), await catId(db, user, "restaurants"), 2_000);
    const b2 = await getBudgetMonth(db, user, "2026-03", prefs, "2026-03-15");
    expect(b2.categories.find((c) => c.name.startsWith("Restaurants"))!.available).toBe(0);
    expect(b2.readyToAssign).toBe(280_000);
    // Next month: groceries leftover (60 000 − 2 000 − 45 000 = 13 000) carries forward.
    const apr = await getBudgetMonth(db, user, "2026-04", prefs, "2026-04-02");
    expect(apr.categories.find((c) => c.name === "Groceries")!.carryIn).toBe(13_000);
    expect(apr.readyToAssign).toBe(280_000);
  });

  it("switching to flexible keeps allocations and history", async () => {
    await setBudgetMethod(db, user, "flexible");
    const prefs = await prefsOf(db, user);
    const b = await getBudgetMonth(db, user, "2026-03", prefs, "2026-03-15");
    expect(b.method).toBe("flexible");
    const groceries = b.categories.find((c) => c.name === "Groceries")!;
    expect(groceries.assigned).toBe(58_000);
    expect(groceries.spent).toBe(45_000);
    expect(groceries.remaining).toBe(13_000);
    expect(groceries.projected).toBeGreaterThan(45_000);
    await setBudgetMethod(db, user, "envelope");
  });

  it("never applies negative or income allocations", async () => {
    await expect(setAssigned(db, user, "2026-03", await catId(db, user, "groceries"), -1)).rejects.toThrow();
    await expect(applyAllocations(db, user, "2026-03", [{ categoryId: await catId(db, user, "salary"), amount: 100 }])).rejects.toThrow(/spending categories/);
  });
});

describe("recurring payments", () => {
  let user: string;
  let acct: string;
  beforeAll(async () => {
    user = await makeUser(db, "Rec");
    acct = (await createAccount(db, user, { name: "Everyday", type: "checking", currency: "NZD", openingBalance: 100_000, openingDate: "2026-01-01" })).id;
  });

  it("a bill is paid only when a matching transaction exists, not when its date passes", async () => {
    const rule = await createRule(db, user, { name: "Mercury Energy", kind: "bill", accountId: acct, amount: 18_000, amountVaries: true, frequency: "monthly", anchorDate: "2026-02-15", categoryId: await catId(db, user, "utilities") }, "2026-03-20");
    let occ = await occurrences(db, user, "2026-03-01", "2026-03-31", "2026-03-25");
    expect(occ.find((o) => o.ruleId === rule.id)!.status).toBe("missed");
    await createTransaction(db, user, { accountId: acct, date: "2026-03-16", amount: -19_250, merchant: "Mercury Energy" });
    occ = await occurrences(db, user, "2026-03-01", "2026-03-31", "2026-03-25");
    const m = occ.find((o) => o.ruleId === rule.id)!;
    expect(m.status).toBe("paid");
    expect(m.actualAmount).toBe(-19_250);
  });

  it("forecasts income and bills, without double counting matched occurrences", async () => {
    await createRule(db, user, { name: "Salary", kind: "income", accountId: acct, amount: 250_000, frequency: "fortnightly", anchorDate: "2026-03-26", categoryId: await catId(db, user, "salary") }, "2026-03-20");
    const f = await buildForecast(db, user, "2026-03-20", 30, { currency: "NZD", safetyBuffer: 5_000, lowBalanceThreshold: 0 });
    expect(f.payday?.date).toBe("2026-03-26");
    expect(f.safe.horizonKind).toBe("payday");
    const evts = f.forecast.points.flatMap((p) => p.events);
    expect(evts.filter((e) => e.label === "Salary")).toHaveLength(2);
    expect(evts.some((e) => e.label === "Mercury Energy" && e.date === "2026-04-15")).toBe(true);
  });

  it("detects subscriptions from history and requires confirmation", async () => {
    for (const d of ["2025-12-03", "2026-01-03", "2026-02-03", "2026-03-03"]) {
      await createTransaction(db, user, { accountId: acct, date: d, amount: -2_299, merchant: "Netflix", categoryId: await catId(db, user, "subscriptions") });
    }
    const s = await detectSuggestions(db, user, "2026-03-20");
    expect(s.map((x) => x.merchantName)).toContain("Netflix");
    const rule = await confirmSuggestion(db, user, s.find((x) => x.merchantName === "Netflix")!.merchantKey, "subscription", "2026-03-20");
    expect(rule.kind).toBe("subscription");
    expect((await detectSuggestions(db, user, "2026-03-20")).map((x) => x.merchantName)).not.toContain("Netflix");
  });
});

describe("exports, notifications, overview and assistant tools", () => {
  it("exports CSV with formula injection neutralised", async () => {
    await createTransaction(db, alice, { accountId: aliceChecking, date: "2026-02-12", amount: -1_234, merchant: "=cmd|' /C calc'!A0", categoryId: null });
    const csv = await exportTransactionsCsv(db, alice, {});
    const rows = parseCsv(csv);
    expect(rows[0]).toContain("Amount");
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("-12.34");
  });

  it("builds the overview from persisted data and dedupes notifications", async () => {
    const prefs = await prefsOf(db, alice);
    const o = await getOverview(db, alice, prefs, "2026-02-25", "month");
    expect(o.totals.cash).toBe((await listAccounts(db, alice)).filter((a) => ["checking", "savings", "cash"].includes(a.type)).reduce((s, a) => s + a.balance, 0));
    await createGoal(db, alice, { name: "Trip", kind: "holiday", targetAmount: 100_000, initialSaved: 60_000 }, "2026-02-25");
    const goals = await listGoals(db, alice, "2026-02-25");
    const ctx = { today: "2026-02-25", currency: "NZD", budget: await getBudgetMonth(db, alice, "2026-02", prefs, "2026-02-25"), forecast: o.forecast, occurrences: [], goals, duplicatePairs: [], priceChanges: [], unusual: [] };
    const map = await getPreferencesMap(db, alice);
    const drafts = draftNotifications(ctx, map);
    expect(drafts.some((d) => d.type === "goal_milestone")).toBe(true);
    const n1 = await saveNotifications(db, alice, drafts, map);
    const n2 = await saveNotifications(db, alice, drafts, map);
    expect(n1).toBeGreaterThan(0);
    expect(n2).toBe(0);
    expect((await listNotifications(db, alice)).length).toBe(n1);
  });

  it("assistant tools validate input and answer from real calculations", async () => {
    const prefs = await prefsOf(db, alice);
    const ctx = { db, userId: alice, prefs, today: "2026-02-25" };
    const tool = toolByName("check_affordability")!;
    expect(tool.input.safeParse({ amount: "150", extra: 1 }).success).toBe(false);
    const reply = await offlineAnswer(ctx, "Can I afford to spend $150 this weekend?", "offline");
    expect(reply.mode).toBe("direct");
    expect(reply.tools[0].name).toBe("check_affordability");
    expect(reply.answer).toMatch(/\$150\.00/);
    const proposal = await toolByName("propose_budget_change")!.run(ctx, { category: "Groceries", month: "2026-02", newAmount: "500", reason: "test" } as never);
    expect(proposal.proposal?.newAmount).toBe(50_000);
    // Proposing doesn't change anything.
    const b = await getBudgetMonth(db, alice, "2026-02", prefs, "2026-02-25");
    expect(b.categories.find((c) => c.name === "Groceries")!.assigned).toBe(0);
  });
});
