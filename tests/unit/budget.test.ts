import { describe, expect, it } from "vitest";
import {
  buildStarterBudget,
  computeEnvelope,
  evaluateLimit,
  monthlyEquivalent,
  projectMonthEnd,
  suggestAdjustments,
  type EnvelopeCell,
} from "@/domain/budget";
import { sum } from "@/domain/money";

function envelope(
  months: string[],
  cats: { id: string; rollover: boolean }[],
  cells: Record<string, Record<string, EnvelopeCell>>,
  funds: Record<string, number>,
) {
  return computeEnvelope({
    months,
    categories: cats,
    cells: (m, c) => cells[m]?.[c],
    funds: (m) => funds[m] ?? 0,
  });
}

describe("envelope budgeting", () => {
  it("tracks ready to assign as income minus assignments", () => {
    const [m] = envelope(
      ["2026-03"],
      [{ id: "groceries", rollover: true }, { id: "rent", rollover: true }],
      { "2026-03": { groceries: { assigned: 60_000, activity: -45_000 }, rent: { assigned: 200_000, activity: -200_000 } } },
      { "2026-03": 400_000 },
    );
    expect(m.readyToAssign).toBe(140_000);
    expect(m.categories.get("groceries")!.available).toBe(15_000);
    expect(m.totalAvailable).toBe(15_000);
  });

  it("carries positive balances forward", () => {
    const [, apr] = envelope(
      ["2026-03", "2026-04"],
      [{ id: "g", rollover: true }],
      { "2026-03": { g: { assigned: 50_000, activity: -40_000 } }, "2026-04": { g: { assigned: 50_000, activity: -10_000 } } },
      { "2026-03": 100_000 },
    );
    expect(apr.categories.get("g")!.carryIn).toBe(10_000);
    expect(apr.categories.get("g")!.available).toBe(50_000);
    expect(apr.readyToAssign).toBe(0);
  });

  it("returns leftovers of non-rollover categories to ready to assign", () => {
    const [, apr] = envelope(
      ["2026-03", "2026-04"],
      [{ id: "fun", rollover: false }],
      { "2026-03": { fun: { assigned: 20_000, activity: -5_000 } } },
      { "2026-03": 20_000 },
    );
    expect(apr.categories.get("fun")!.carryIn).toBe(0);
    expect(apr.returned).toBe(15_000);
    expect(apr.readyToAssign).toBe(15_000);
  });

  it("makes overspending explicit and deducts it next month", () => {
    const [mar, apr] = envelope(
      ["2026-03", "2026-04"],
      [{ id: "dining", rollover: true }],
      { "2026-03": { dining: { assigned: 10_000, activity: -13_000 } } },
      { "2026-03": 50_000, "2026-04": 0 },
    );
    expect(mar.categories.get("dining")!.overspent).toBe(3_000);
    expect(mar.overspentTotal).toBe(3_000);
    expect(apr.categories.get("dining")!.carryIn).toBe(0);
    expect(apr.overspentDeducted).toBe(3_000);
    expect(apr.readyToAssign).toBe(40_000 - 3_000);
  });

  it("refunds add back to the category's available balance", () => {
    const [m] = envelope(
      ["2026-03"],
      [{ id: "s", rollover: true }],
      { "2026-03": { s: { assigned: 10_000, activity: -10_000 + 2_500 } } },
      { "2026-03": 10_000 },
    );
    expect(m.categories.get("s")!.available).toBe(2_500);
  });

  it("goes negative when more is assigned than available", () => {
    const [m] = envelope(["2026-03"], [{ id: "a", rollover: true }], { "2026-03": { a: { assigned: 150_000, activity: 0 } } }, { "2026-03": 100_000 });
    expect(m.readyToAssign).toBe(-50_000);
  });

  it("conserves money: RTA + category balances = funds − spending", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const cats = [
      { id: "a", rollover: true },
      { id: "b", rollover: false },
    ];
    const cells = {
      "2026-01": { a: { assigned: 30_000, activity: -10_000 }, b: { assigned: 20_000, activity: -25_000 } },
      "2026-02": { a: { assigned: 10_000, activity: -50_000 }, b: { assigned: 20_000, activity: -5_000 } },
      "2026-03": { a: { assigned: 40_000, activity: -1_000 }, b: { assigned: 5_000, activity: 0 } },
    };
    const funds = { "2026-01": 100_000, "2026-02": 30_000, "2026-03": 30_000 };
    const res = envelope(months, cats, cells, funds);
    const last = res[res.length - 1];
    const totalFunds = sum(Object.values(funds));
    const totalActivity = sum(months.flatMap((m) => Object.values(cells[m as keyof typeof cells]).map((c) => c.activity)));
    const positiveAvail = sum([...last.categories.values()].map((c) => c.available));
    // Last month's overspending hasn't been deducted yet, so it's included via negative available.
    expect(last.readyToAssign + positiveAvail).toBe(totalFunds + totalActivity);
  });
});

describe("flexible budgeting", () => {
  it("warns at the threshold and flags overspending", () => {
    expect(evaluateLimit({ id: "a", limit: 10_000, spent: 5_000 }).status).toBe("ok");
    expect(evaluateLimit({ id: "a", limit: 10_000, spent: 8_600 }).status).toBe("warning");
    expect(evaluateLimit({ id: "a", limit: 10_000, spent: 10_001 }).status).toBe("over");
    expect(evaluateLimit({ id: "a", limit: 0, spent: 100 }).status).toBe("unbudgeted");
    expect(evaluateLimit({ id: "a", limit: 10_000, spent: 6_000, alertThresholdBps: 5_000 }).status).toBe("warning");
    expect(evaluateLimit({ id: "a", limit: 10_000, spent: 2_500 }).remaining).toBe(7_500);
  });
});

describe("projection", () => {
  it("uses pace when there is no history", () => {
    const p = projectMonthEnd({ month: "2026-04", dayOfMonth: 10, spentSoFar: 10_000 });
    expect(p.projected).toBe(30_000);
    expect(p.method).toBe("pace");
  });

  it("blends pace with history", () => {
    const p = projectMonthEnd({ month: "2026-04", dayOfMonth: 15, spentSoFar: 30_000, historicalMonthlyAverage: 40_000 });
    // pace = 60 000; blended = 60 000×15/30 + 40 000×15/30 = 50 000
    expect(p.projected).toBe(50_000);
  });

  it("never projects below what was already spent and adds scheduled bills", () => {
    const p = projectMonthEnd({ month: "2026-04", dayOfMonth: 2, spentSoFar: 50_000, historicalMonthlyAverage: 10_000, scheduledRemaining: 5_000 });
    expect(p.projected).toBeGreaterThanOrEqual(55_000);
  });

  it("does not extrapolate recurring bills on top of scheduling them", () => {
    // Weekly rent: 2 payments of $500 by day 14, 2 more scheduled. No variable spending.
    const p = projectMonthEnd({ month: "2026-04", dayOfMonth: 14, spentSoFar: 100_000, fixedSoFar: 100_000, scheduledRemaining: 100_000 });
    expect(p.projected).toBe(200_000);
  });

  it("reports the actual total when the month is complete", () => {
    expect(projectMonthEnd({ month: "2026-04", dayOfMonth: 30, spentSoFar: 1234 }).projected).toBe(1234);
  });
});

describe("suggestions", () => {
  it("suggests increases for consistent overspending and decreases for consistent underspending", () => {
    const s = suggestAdjustments([
      { id: "d", name: "Dining", budgeted: 20_000, monthlySpending: [25_000, 27_000, 19_000] },
      { id: "e", name: "Entertainment", budgeted: 20_000, monthlySpending: [5_000, 6_000, 4_000] },
      { id: "g", name: "Groceries", budgeted: 60_000, monthlySpending: [58_000, 61_000, 59_000] },
    ]);
    expect(s.find((x) => x.categoryId === "d")).toMatchObject({ kind: "increase", suggested: 25_000 });
    expect(s.find((x) => x.categoryId === "e")).toMatchObject({ kind: "decrease", suggested: 7_000 });
    expect(s.find((x) => x.categoryId === "g")).toBeUndefined();
  });

  it("needs enough history", () => {
    expect(suggestAdjustments([{ id: "d", name: "D", budgeted: 1, monthlySpending: [5, 5] }])).toEqual([]);
  });
});

describe("starter budget", () => {
  it("normalises income frequencies", () => {
    expect(monthlyEquivalent(100_000, "weekly")).toBe(433_333);
    expect(monthlyEquivalent(200_000, "fortnightly")).toBe(433_333);
    expect(monthlyEquivalent(500_000, "monthly")).toBe(500_000);
  });

  it("covers commitments first and never over-allocates", () => {
    const b = buildStarterBudget({
      monthlyIncome: 400_000,
      fixed: [{ categoryKey: "housing", amount: 180_000 }, { categoryKey: "utilities", amount: 20_000 }],
      debtMinimums: 15_000,
      goalContributions: 30_000,
      variable: [{ categoryKey: "groceries" }, { categoryKey: "transport", typical: 12_000 }, { categoryKey: "restaurants" }],
    });
    const total = sum(b.allocations.map((a) => a.amount));
    expect(total).toBeLessThanOrEqual(400_000);
    expect(b.unallocated).toBe(400_000 - total);
    expect(b.allocations.find((a) => a.categoryKey === "housing")!.amount).toBe(180_000);
    expect(b.allocations.find((a) => a.categoryKey === "transport")!.amount).toBe(12_000);
    expect(b.allocations.find((a) => a.categoryKey === "groceries")!.amount).toBeGreaterThan(0);
    expect(b.shortfall).toBe(0);
  });

  it("reports a shortfall instead of inventing money", () => {
    const b = buildStarterBudget({
      monthlyIncome: 100_000,
      fixed: [{ categoryKey: "housing", amount: 120_000 }],
      debtMinimums: 0,
      goalContributions: 0,
      variable: [{ categoryKey: "groceries" }],
    });
    expect(b.shortfall).toBe(20_000);
    expect(b.allocations.find((a) => a.categoryKey === "groceries")!.amount).toBe(0);
  });
});
