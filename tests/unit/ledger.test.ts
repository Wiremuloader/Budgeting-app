import { describe, expect, it } from "vitest";
import {
  accountBalance,
  reconcile,
  spendingByCategory,
  summarize,
  totals,
  transferLegs,
  validateSplits,
  type LedgerLine,
} from "@/domain/ledger";

let n = 0;
const line = (p: Partial<LedgerLine>): LedgerLine => ({
  transactionId: `t${n++}`,
  date: "2026-03-10",
  accountId: "chk",
  amount: 0,
  kind: "standard",
  status: "cleared",
  categoryId: null,
  categoryGroup: null,
  ...p,
});

describe("income and spending classification", () => {
  it("counts income and expenses", () => {
    const s = summarize([
      line({ amount: 300_000, categoryId: "salary", categoryGroup: "income" }),
      line({ amount: -12_000, categoryId: "groceries", categoryGroup: "expense" }),
      line({ amount: -3_000, categoryId: "dining", categoryGroup: "expense" }),
    ]);
    expect(s.income).toBe(300_000);
    expect(s.spending).toBe(15_000);
    expect(s.net).toBe(285_000);
    expect(s.savingsRateBps).toBe(9500);
  });

  it("excludes transfers between own accounts from income and spending", () => {
    const legs = transferLegs("chk", "sav", 50_000);
    const s = summarize([
      line({ accountId: legs.from.accountId, amount: legs.from.amount, kind: "transfer" }),
      line({ accountId: legs.to.accountId, amount: legs.to.amount, kind: "transfer" }),
    ]);
    expect(s.income).toBe(0);
    expect(s.spending).toBe(0);
    expect(legs.from.amount + legs.to.amount).toBe(0);
  });

  it("does not double count credit-card purchases and repayments", () => {
    // $80 purchase on the card is spending once. Paying the card from checking is a transfer.
    const s = summarize([
      line({ accountId: "card", amount: -8_000, categoryId: "dining", categoryGroup: "expense" }),
      line({ accountId: "chk", amount: -8_000, kind: "transfer" }),
      line({ accountId: "card", amount: 8_000, kind: "transfer" }),
    ]);
    expect(s.spending).toBe(8_000);
  });

  it("refunds reduce spending in their category", () => {
    const lines = [
      line({ amount: -10_000, categoryId: "shopping", categoryGroup: "expense" }),
      line({ amount: 4_000, categoryId: "shopping", categoryGroup: "expense" }),
    ];
    const s = summarize(lines);
    expect(s.spending).toBe(6_000);
    expect(s.refunds).toBe(4_000);
    expect(spendingByCategory(lines).get("shopping")).toBe(6_000);
  });

  it("never treats unreviewed inflows as income", () => {
    const s = summarize([line({ amount: 50_000 })]);
    expect(s.income).toBe(0);
    expect(s.uncategorisedInflows).toBe(50_000);
    expect(s.savingsRateBps).toBeNull();
  });

  it("counts uncategorised outflows as spending, separately reported", () => {
    const s = summarize([line({ amount: -2_500 })]);
    expect(s.spending).toBe(2_500);
    expect(s.uncategorisedOutflows).toBe(2_500);
  });

  it("excludes balance adjustments", () => {
    const s = summarize([line({ amount: -9_999, kind: "adjustment", categoryGroup: "expense", categoryId: "x" })]);
    expect(s.spending).toBe(0);
  });

  it("reports pending spending separately while including it", () => {
    const s = summarize([
      line({ amount: -1_000, categoryId: "c", categoryGroup: "expense", status: "pending" }),
      line({ amount: -2_000, categoryId: "c", categoryGroup: "expense" }),
    ]);
    expect(s.spending).toBe(3_000);
    expect(s.pendingSpending).toBe(1_000);
  });

  it("split lines are classified per part", () => {
    // $150 supermarket shop: $120 groceries + $30 household (shopping)
    const lines = [
      line({ transactionId: "s", amount: -12_000, categoryId: "groceries", categoryGroup: "expense" }),
      line({ transactionId: "s", amount: -3_000, categoryId: "shopping", categoryGroup: "expense" }),
    ];
    const by = spendingByCategory(lines);
    expect(by.get("groceries")).toBe(12_000);
    expect(by.get("shopping")).toBe(3_000);
    expect(summarize(lines).spending).toBe(15_000);
  });
});

describe("splits", () => {
  it("must reconcile exactly to the parent", () => {
    expect(() => validateSplits(-15_000, [{ categoryId: "a", amount: -12_000 }, { categoryId: "b", amount: -3_000 }])).not.toThrow();
    expect(() => validateSplits(-15_000, [{ categoryId: "a", amount: -12_000 }, { categoryId: "b", amount: -2_999 }])).toThrow(/difference -1/);
    expect(() => validateSplits(-15_000, [{ categoryId: "a", amount: -15_000 }])).toThrow(/two parts/);
    expect(() => validateSplits(-15_000, [{ categoryId: "a", amount: -15_000 }, { categoryId: "b", amount: 0 }])).toThrow(/zero/);
  });
});

describe("balances and totals", () => {
  it("separates cleared and pending", () => {
    const b = accountBalance([
      { amount: 100_000, status: "cleared" },
      { amount: -2_000, status: "pending" },
      { amount: -500, status: "reconciled" },
    ]);
    expect(b).toEqual({ current: 97_500, cleared: 99_500, pending: -2_000 });
  });

  it("distinguishes cash, spendable, net worth and excludes other currencies", () => {
    const t = totals(
      [
        { id: "chk", type: "checking", currency: "NZD", balance: 250_000, includeInNetWorth: true, spendable: true },
        { id: "sav", type: "savings", currency: "NZD", balance: 1_000_000, includeInNetWorth: true, spendable: false },
        { id: "card", type: "credit_card", currency: "NZD", balance: -80_000, includeInNetWorth: true, spendable: false },
        { id: "loan", type: "loan", currency: "NZD", balance: -2_000_000, includeInNetWorth: true, spendable: false },
        { id: "aud", type: "savings", currency: "AUD", balance: 500_000, includeInNetWorth: true, spendable: false },
        { id: "old", type: "checking", currency: "NZD", balance: 999, includeInNetWorth: true, spendable: true, archived: true },
      ],
      "NZD",
    );
    expect(t.cash).toBe(1_250_000);
    expect(t.spendable).toBe(250_000);
    expect(t.assets).toBe(1_250_000);
    expect(t.liabilities).toBe(2_080_000);
    expect(t.netWorth).toBe(-830_000);
    expect(t.excludedAccountIds).toEqual(["aud"]);
  });

  it("transfers do not change net worth", () => {
    const before = totals(
      [
        { id: "chk", type: "checking", currency: "NZD", balance: 100_000, includeInNetWorth: true, spendable: true },
        { id: "card", type: "credit_card", currency: "NZD", balance: -40_000, includeInNetWorth: true, spendable: false },
      ],
      "NZD",
    );
    const legs = transferLegs("chk", "card", 40_000);
    const after = totals(
      [
        { id: "chk", type: "checking", currency: "NZD", balance: 100_000 + legs.from.amount, includeInNetWorth: true, spendable: true },
        { id: "card", type: "credit_card", currency: "NZD", balance: -40_000 + legs.to.amount, includeInNetWorth: true, spendable: false },
      ],
      "NZD",
    );
    expect(after.netWorth).toBe(before.netWorth);
  });

  it("reconciles against a statement", () => {
    expect(reconcile(10_000, 10_000).balanced).toBe(true);
    expect(reconcile(10_000, 9_950).difference).toBe(-50);
  });

  it("rejects invalid transfers", () => {
    expect(() => transferLegs("a", "a", 100)).toThrow();
    expect(() => transferLegs("a", "b", -100)).toThrow();
  });
});
