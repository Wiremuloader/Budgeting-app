import { describe, expect, it } from "vitest";
import { compareStrategies, monthlyInterest, simulatePayoff, type DebtInput } from "@/domain/debt";
import { earmarkWarnings, goalProgress, goalScenarios } from "@/domain/goals";

const debts: DebtInput[] = [
  { id: "card", name: "Visa", balance: 300_000, aprBps: 2095, minimumPayment: 9_000 },
  { id: "car", name: "Car loan", balance: 800_000, aprBps: 1200, minimumPayment: 25_000 },
  { id: "store", name: "Store card", balance: 60_000, aprBps: 2595, minimumPayment: 3_000 },
];

describe("debt payoff", () => {
  it("calculates monthly interest with explicit rounding", () => {
    expect(monthlyInterest(100_000, 1200)).toBe(1_000); // $1,000 at 12 % → $10.00/month
    expect(monthlyInterest(333_33, 1999)).toBe(555); // 555.27 → 555
    expect(monthlyInterest(100_000, 0)).toBe(0);
  });

  it("an interest-free loan pays off in balance ÷ payment months", () => {
    const r = simulatePayoff([{ id: "sl", name: "Student loan", balance: 120_000, aprBps: 0, minimumPayment: 10_000 }], "avalanche");
    expect(r.months).toBe(12);
    expect(r.totalInterest).toBe(0);
    expect(r.totalPaid).toBe(120_000);
  });

  it("orders avalanche by rate and snowball by balance", () => {
    expect(simulatePayoff(debts, "avalanche", 10_000).order).toEqual(["store", "card", "car"]);
    expect(simulatePayoff(debts, "snowball", 10_000).order).toEqual(["store", "card", "car"]);
    const alt: DebtInput[] = [
      { id: "big-high", name: "A", balance: 500_000, aprBps: 2500, minimumPayment: 10_000 },
      { id: "small-low", name: "B", balance: 50_000, aprBps: 500, minimumPayment: 2_000 },
    ];
    expect(simulatePayoff(alt, "avalanche").order).toEqual(["big-high", "small-low"]);
    expect(simulatePayoff(alt, "snowball").order).toEqual(["small-low", "big-high"]);
  });

  it("avalanche never pays more interest than snowball; extra payments beat minimums", () => {
    const c = compareStrategies(debts, 20_000);
    expect(c.avalanche.totalInterest).toBeLessThanOrEqual(c.snowball.totalInterest);
    expect(c.avalanche.months!).toBeLessThan(c.minimum.months!);
    expect(c.interestSaved!).toBeGreaterThan(0);
  });

  it("total paid = principal + interest", () => {
    const r = simulatePayoff(debts, "snowball", 15_000);
    const principal = debts.reduce((a, d) => a + d.balance, 0);
    expect(r.totalPaid).toBe(principal + r.totalInterest);
    expect(r.balanceByMonth.at(-1)).toBe(0);
  });

  it("warns when payments don't cover interest", () => {
    const r = simulatePayoff([{ id: "x", name: "X", balance: 1_000_000, aprBps: 2400, minimumPayment: 10_000 }], "avalanche");
    expect(r.months).toBeNull();
    expect(r.warnings[0]).toMatch(/do not cover the interest/);
  });

  it("applies explicit rate changes", () => {
    const base = { id: "m", name: "M", balance: 500_000, aprBps: 600, minimumPayment: 20_000 };
    const fixed = simulatePayoff([base], "avalanche");
    const rising = simulatePayoff([{ ...base, rateChanges: [{ fromMonth: 6, aprBps: 900 }] }], "avalanche");
    expect(rising.totalInterest).toBeGreaterThan(fixed.totalInterest);
  });
});

describe("savings goals", () => {
  it("computes required contributions and on-track status", () => {
    const p = goalProgress(
      { targetAmount: 600_000, savedAmount: 120_000, targetDate: "2027-04-16", plannedContribution: 50_000, cadence: "monthly" },
      "2026-10-16",
    );
    expect(p.remaining).toBe(480_000);
    expect(p.progressBps).toBe(2000);
    expect(p.periodsUntilTarget).toBe(6);
    expect(p.requiredPerPeriod).toBe(80_000);
    expect(p.estimatedCompletion).toBe("2027-08-16"); // 10 months at $500
    expect(p.status).toBe("behind");
  });

  it("handles completed and overdue goals", () => {
    expect(goalProgress({ targetAmount: 100, savedAmount: 150 }, "2026-01-01").status).toBe("complete");
    expect(goalProgress({ targetAmount: 100, savedAmount: 150 }, "2026-01-01").progressBps).toBe(10_000);
    expect(goalProgress({ targetAmount: 100, savedAmount: 10, targetDate: "2025-12-01" }, "2026-01-01").status).toBe("overdue");
  });

  it("scenario planning shows the effect of different contributions", () => {
    const g = { targetAmount: 300_000, savedAmount: 0, plannedContribution: 25_000, cadence: "fortnightly" as const };
    const [same, more] = goalScenarios(g, "2026-01-01", [25_000, 50_000]);
    expect(same.periods).toBe(12);
    expect(same.deltaDays).toBe(0);
    expect(more.periods).toBe(6);
    expect(more.deltaDays).toBe(84);
  });

  it("flags earmarks that exceed the linked account's balance", () => {
    const w = earmarkWarnings(
      [{ id: "sav", balance: 100_000 }, { id: "card", balance: -50_000 }],
      [
        { linkedAccountId: "sav", savedAmount: 80_000 },
        { linkedAccountId: "sav", savedAmount: 40_000 },
        { linkedAccountId: null, savedAmount: 999 },
      ],
    );
    expect(w).toEqual([{ accountId: "sav", accountBalance: 100_000, earmarked: 120_000, overAllocated: 20_000 }]);
  });
});
