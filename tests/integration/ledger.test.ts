import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@/server/db";
import { transactions, transactionSplits } from "@/server/db/schema";
import { catId, freshDb, makeUser, prefsOf } from "./helpers";
import { accountTotals, adjustBalance, createAccount, deleteAccount, listAccounts, reconcileAccount, setAccountArchived } from "@/server/services/accounts";
import {
  bulkDelete,
  bulkUpdate,
  createTransaction,
  createTransfer,
  deleteTransaction,
  ledgerLines,
  linkAsTransfer,
  listTransactions,
  transactionHistory,
  updateTransaction,
} from "@/server/services/transactions";
import { createCategory, setCategoryArchived, updateCategory } from "@/server/services/categories";
import { summarize } from "@/domain/ledger";
import { createDebtWithAccount, listDebts, payoffPlan } from "@/server/services/debts";
import { addContribution, createGoal, listGoals } from "@/server/services/goals";

let db: Database;
let close: () => Promise<void>;
let user: string;
let checking: string;
let savings: string;
let card: string;

beforeAll(async () => {
  ({ db, close } = await freshDb());
  user = await makeUser(db);
  checking = (await createAccount(db, user, { name: "Everyday", type: "checking", currency: "NZD", openingBalance: 200_000, openingDate: "2026-03-01" })).id;
  savings = (await createAccount(db, user, { name: "Savings", type: "savings", currency: "NZD", openingBalance: 500_000, openingDate: "2026-03-01" })).id;
  card = (await createAccount(db, user, { name: "Visa", type: "credit_card", currency: "NZD", openingBalance: -30_000, openingDate: "2026-03-01" })).id;
});
afterAll(() => close());

const balanceOf = async (id: string) => (await listAccounts(db, user)).find((a) => a.id === id)!.balance;
const march = { from: "2026-03-01", to: "2026-03-31" };

describe("accounts", () => {
  it("records opening balances as auditable adjustments and keeps figures distinct", async () => {
    const accounts = await listAccounts(db, user);
    const t = accountTotals(accounts, "NZD");
    expect(t.cash).toBe(700_000);
    expect(t.spendable).toBe(200_000); // savings and cards aren't spendable by default
    expect(t.liabilities).toBe(30_000);
    expect(t.netWorth).toBe(670_000);
    // Opening balances are not income.
    expect(summarize(await ledgerLines(db, user, march)).income).toBe(0);
  });

  it("adjusts balances with an explanation and reconciles", async () => {
    const acc = (await createAccount(db, user, { name: "Wallet", type: "cash", currency: "NZD", openingBalance: 5_000, openingDate: "2026-03-01" })).id;
    await expect(adjustBalance(db, user, acc, { newBalance: 4_000, date: "2026-03-02", reason: "" })).rejects.toThrow(/explain/);
    const r = await adjustBalance(db, user, acc, { newBalance: 4_000, date: "2026-03-02", reason: "Counted cash" });
    expect(r.difference).toBe(-1_000);
    expect(await balanceOf(acc)).toBe(4_000);
    expect((await reconcileAccount(db, user, acc, { statementBalance: 3_900, statementDate: "2026-03-02" })).difference).toBe(-100);
    const ok = await reconcileAccount(db, user, acc, { statementBalance: 4_000, statementDate: "2026-03-02" });
    expect(ok.balanced).toBe(true);
    expect(ok.reconciledCount).toBeGreaterThan(0);
    // Archived accounts drop out of totals; accounts with history can't be deleted.
    await setAccountArchived(db, user, acc, true);
    expect((await listAccounts(db, user)).some((a) => a.id === acc)).toBe(false);
  });

  it("refuses to delete accounts with history", async () => {
    await createTransaction(db, user, { accountId: checking, date: "2026-03-03", amount: -1_000, merchant: "Test", categoryId: null });
    await expect(deleteAccount(db, user, checking)).rejects.toThrow(/Archive/);
  });
});

describe("transactions and financial rules", () => {
  it("income, expenses, refunds and pending", async () => {
    const salary = await catId(db, user, "salary");
    const groceries = await catId(db, user, "groceries");
    const shopping = await catId(db, user, "shopping");
    await createTransaction(db, user, { accountId: checking, date: "2026-03-05", amount: 400_000, merchant: "Acme Ltd", categoryId: salary });
    await createTransaction(db, user, { accountId: checking, date: "2026-03-06", amount: -15_000, merchant: "Countdown", categoryId: groceries });
    await createTransaction(db, user, { accountId: card, date: "2026-03-07", amount: -20_000, merchant: "Kmart", categoryId: shopping });
    await createTransaction(db, user, { accountId: card, date: "2026-03-09", amount: 5_000, merchant: "Kmart", categoryId: shopping });
    await createTransaction(db, user, { accountId: checking, date: "2026-03-10", amount: -2_500, merchant: "Countdown", categoryId: groceries, status: "pending" });
    const s = summarize(await ledgerLines(db, user, march, { kinds: ["standard"] }));
    expect(s.income).toBe(400_000);
    expect(s.refunds).toBe(5_000);
    expect(s.pendingSpending).toBe(2_500);
    // 15 000 + 20 000 − 5 000 + 2 500 + 1 000 (uncategorised "Test")
    expect(s.spending).toBe(33_500);
    const acc = (await listAccounts(db, user)).find((a) => a.id === checking)!;
    expect(acc.pendingBalance).toBe(-2_500);
  });

  it("transfers and card repayments are neither income nor spending, and conserve net worth", async () => {
    const before = accountTotals(await listAccounts(db, user), "NZD");
    const spendBefore = summarize(await ledgerLines(db, user, march, { kinds: ["standard"] })).spending;
    await createTransfer(db, user, { fromAccountId: checking, toAccountId: card, amount: 15_000, date: "2026-03-12" });
    await createTransfer(db, user, { fromAccountId: checking, toAccountId: savings, amount: 50_000, date: "2026-03-12" });
    const after = accountTotals(await listAccounts(db, user), "NZD");
    expect(after.netWorth).toBe(before.netWorth);
    expect(after.cash).toBe(before.cash - 15_000);
    expect(summarize(await ledgerLines(db, user, march, { kinds: ["standard"] })).spending).toBe(spendBefore);
    await expect(createTransfer(db, user, { fromAccountId: checking, toAccountId: checking, amount: 1, date: "2026-03-12" })).rejects.toThrow();
  });

  it("splits must reconcile and are counted per category", async () => {
    const groceries = await catId(db, user, "groceries");
    const shopping = await catId(db, user, "shopping");
    await expect(
      createTransaction(db, user, { accountId: checking, date: "2026-03-14", amount: -15_000, merchant: "Warehouse", splits: [{ categoryId: groceries, amount: -10_000 }, { categoryId: shopping, amount: -4_000 }] }),
    ).rejects.toThrow(/difference/);
    const t = await createTransaction(db, user, {
      accountId: checking,
      date: "2026-03-14",
      amount: -15_000,
      merchant: "Warehouse",
      splits: [{ categoryId: groceries, amount: -10_000 }, { categoryId: shopping, amount: -5_000 }],
    });
    expect(t.isSplit).toBe(true);
    expect(t.categoryId).toBeNull();
    const lines = (await ledgerLines(db, user, march)).filter((l) => l.transactionId === t.id);
    expect(lines.map((l) => l.amount).sort()).toEqual([-10_000, -5_000]);
    // Changing the total without the parts is rejected.
    await expect(updateTransaction(db, user, t.id, { amount: -16_000 })).rejects.toThrow(/split/);
    await updateTransaction(db, user, t.id, { amount: -16_000, splits: [{ categoryId: groceries, amount: -11_000 }, { categoryId: shopping, amount: -5_000 }] });
    const parts = await db.select().from(transactionSplits).where(eq(transactionSplits.transactionId, t.id));
    expect(parts.reduce((a, p) => a + p.amount, 0)).toBe(-16_000);
  });

  it("editing and deleting update balances and totals; history is audited", async () => {
    const before = await balanceOf(checking);
    const t = await createTransaction(db, user, { accountId: checking, date: "2026-03-15", amount: -4_000, merchant: "Cafe", categoryId: null });
    expect(await balanceOf(checking)).toBe(before - 4_000);
    await updateTransaction(db, user, t.id, { amount: -4_500, notes: "with muffin" });
    expect(await balanceOf(checking)).toBe(before - 4_500);
    const history = await transactionHistory(db, user, t.id);
    expect(history.map((h) => h.action)).toEqual(expect.arrayContaining(["create", "update"]));
    await deleteTransaction(db, user, t.id);
    expect(await balanceOf(checking)).toBe(before);
  });

  it("editing a transfer moves both legs; deleting removes both", async () => {
    const { outLeg } = await createTransfer(db, user, { fromAccountId: savings, toAccountId: checking, amount: 10_000, date: "2026-03-16" });
    await updateTransaction(db, user, outLeg.id, { amount: 12_000 });
    const legs = await db.select().from(transactions).where(eq(transactions.transferGroupId, outLeg.transferGroupId!));
    expect(legs.map((l) => l.amount).sort((a, b) => a - b)).toEqual([-12_000, 12_000]);
    await deleteTransaction(db, user, outLeg.id);
    expect(await db.select().from(transactions).where(eq(transactions.transferGroupId, outLeg.transferGroupId!))).toHaveLength(0);
  });

  it("links an imported pair as a transfer so the payment stops counting as spending", async () => {
    const a = await createTransaction(db, user, { accountId: checking, date: "2026-03-20", amount: -7_000, merchant: "Payment to Visa", categoryId: null });
    const b = await createTransaction(db, user, { accountId: card, date: "2026-03-21", amount: 7_000, merchant: "Payment received", categoryId: null });
    const spendBefore = summarize(await ledgerLines(db, user, march, { kinds: ["standard"] })).spending;
    await linkAsTransfer(db, user, a.id, b.id);
    expect(summarize(await ledgerLines(db, user, march, { kinds: ["standard"] })).spending).toBe(spendBefore - 7_000);
  });

  it("filters, searches, paginates and bulk edits", async () => {
    const dining = await catId(db, user, "restaurants");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await createTransaction(db, user, { accountId: card, date: `2026-03-2${i}`, amount: -(1_000 + i), merchant: `Sushi Place ${i}`, categoryId: null, notes: i === 2 ? "team lunch" : null })).id);
    const page1 = await listTransactions(db, user, { q: "sushi", pageSize: 2 });
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page1.pages).toBe(3);
    expect((await listTransactions(db, user, { q: "team lunch" })).total).toBe(1);
    expect((await listTransactions(db, user, { q: "%" })).total).toBe(0); // wildcards are escaped
    const r = await bulkUpdate(db, user, ids, { categoryId: dining, reviewed: true });
    expect(r.updated).toBe(5);
    expect((await listTransactions(db, user, { categoryId: dining })).total).toBe(5);
    expect((await listTransactions(db, user, { type: "refund" })).total).toBe(1);
    expect((await listTransactions(db, user, { minAmount: 1_003, q: "sushi" })).total).toBe(2);
    const d = await bulkDelete(db, user, ids.slice(0, 2));
    expect(d.deleted).toBe(2);
  });

  it("rejects stale edits (optimistic concurrency)", async () => {
    const t = await createTransaction(db, user, { accountId: checking, date: "2026-03-22", amount: -100, merchant: "X", categoryId: null });
    const stale = new Date(t.updatedAt.getTime() - 1000).toISOString();
    await expect(updateTransaction(db, user, t.id, { notes: "a", expectedUpdatedAt: stale })).rejects.toThrow(/changed elsewhere/);
    await updateTransaction(db, user, t.id, { notes: "b", expectedUpdatedAt: t.updatedAt.toISOString() });
  });

  it("learns categories from previous transactions for the same merchant", async () => {
    const groceries = await catId(db, user, "groceries");
    const t = await createTransaction(db, user, { accountId: checking, date: "2026-03-23", amount: -3_000, merchant: "Countdown" });
    expect(t.categoryId).toBe(groceries);
  });
});

describe("categories", () => {
  it("enforces unique active names and keeps history when archived", async () => {
    const c = await createCategory(db, user, { name: "Pets", group: "expense" });
    await expect(createCategory(db, user, { name: "pets", group: "expense" })).rejects.toThrow(/already exists/);
    const t = await createTransaction(db, user, { accountId: checking, date: "2026-03-24", amount: -2_000, merchant: "Vet", categoryId: c.id });
    await setCategoryArchived(db, user, c.id, true);
    const [row] = await db.select().from(transactions).where(eq(transactions.id, t.id));
    expect(row.categoryId).toBe(c.id);
    await expect(createTransaction(db, user, { accountId: checking, date: "2026-03-24", amount: -1, merchant: "Vet 2", categoryId: c.id })).rejects.toThrow(/archived/);
    await createCategory(db, user, { name: "Pets", group: "expense" }); // name is free again
    await updateCategory(db, user, c.id, { name: "Pets (old)" });
  });
});

describe("database constraints", () => {
  it("rejects a transfer without a group id and a split row with a category", async () => {
    await expect(
      db.insert(transactions).values({ userId: user, accountId: checking, date: "2026-03-01", amount: -1, currency: "NZD", merchant: "x", merchantKey: "x", kind: "transfer" }),
    ).rejects.toThrow();
    await expect(
      db.insert(transactions).values({ userId: user, accountId: checking, date: "2026-03-01", amount: -1, currency: "NZD", merchant: "x", merchantKey: "x", isSplit: true, categoryId: await catId(db, user, "groceries") }),
    ).rejects.toThrow();
    await expect(db.execute(sql`insert into transactions (user_id, account_id, date, amount, currency, merchant, merchant_key, kind) values (${user}, ${checking}, '2026-03-01', 1, 'NZD', 'x', 'x', 'bogus')`)).rejects.toThrow();
  });
});

describe("debts and goals", () => {
  it("records a debt, links payments and projects payoff", async () => {
    await createDebtWithAccount(db, user, { name: "Car loan", kind: "vehicle", currency: "NZD", balanceOwed: 900_000, asOf: "2026-03-01", aprBps: 1290, minimumPayment: 30_000 });
    const [debt] = (await listDebts(db, user, "2026-03-25")).filter((d) => d.accountName === "Car loan");
    expect(debt.balance).toBe(900_000);
    await createTransfer(db, user, { fromAccountId: checking, toAccountId: debt.accountId, amount: 30_000, date: "2026-03-25", categoryId: await catId(db, user, "debt_repayments") });
    const [after] = (await listDebts(db, user, "2026-03-26")).filter((d) => d.accountName === "Car loan");
    expect(after.balance).toBe(870_000);
    expect(after.payments).toHaveLength(1);
    const plan = payoffPlan([after], 10_000);
    expect(plan.avalanche.months).toBeLessThan(plan.minimum.months!);
    // Student loans can be interest-free.
    await createDebtWithAccount(db, user, { name: "StudyLink", kind: "student_loan", currency: "NZD", balanceOwed: 2_500_000, asOf: "2026-03-01", aprBps: 0, minimumPayment: 0 });
  });

  it("tracks goal contributions as earmarks without moving money", async () => {
    const before = await balanceOf(savings);
    const g = await createGoal(db, user, { name: "Emergency fund", kind: "emergency_fund", targetAmount: 300_000, linkedAccountId: savings, plannedContribution: 50_000, initialSaved: 100_000 }, "2026-03-25");
    await addContribution(db, user, g.id, { amount: 50_000, date: "2026-03-26" });
    await expect(addContribution(db, user, g.id, { amount: -500_000, date: "2026-03-26" })).rejects.toThrow(/withdraw/);
    const [view] = (await listGoals(db, user, "2026-03-26")).filter((x) => x.id === g.id);
    expect(view.savedAmount).toBe(150_000);
    expect(view.progress.progressBps).toBe(5000);
    expect(await balanceOf(savings)).toBe(before);
    const done = await addContribution(db, user, g.id, { amount: 150_000, date: "2026-03-27" });
    expect(done.completed).toBe(true);
  });
});

describe("preferences bootstrap", () => {
  it("creates default preferences and categories", async () => {
    const p = await prefsOf(db, user);
    expect(p.currency).toBe("NZD");
    expect(p.timezone).toBe("Pacific/Auckland");
  });
});
