import { describe, expect, it } from "vitest";
import { estimateVariableSpending, forecastCashFlow } from "@/domain/forecast";
import { safeToSpend } from "@/domain/safe-to-spend";
import { escapeCell, parseCsv, toCsv } from "@/domain/csv";
import { detectDateFormat, guessMapping, mapRows, parseDateWithFormat } from "@/domain/import";
import { normalizeMerchant, applyMerchantRules } from "@/domain/merchant";
import { findPossibleDuplicates, fingerprintRows } from "@/domain/duplicates";
import { detectRecurring, annualise } from "@/domain/subscriptions";
import { addDays } from "@/domain/dates";

describe("cash-flow forecast", () => {
  const variable = { dailyOptimistic: 1_000, dailyExpected: 2_000, dailyConservative: 3_000, weeksOfHistory: 12, sufficient: true };

  it("adds scheduled income and bills and subtracts variable spending", () => {
    const f = forecastCashFlow({
      today: "2026-03-01",
      days: 7,
      startBalance: 100_000,
      variable,
      flows: [
        { amount: 250_000, label: "Pay", source: "recurring", rule: { frequency: "fortnightly", anchorDate: "2026-03-05" } },
        { amount: -150_000, label: "Rent", source: "recurring", rule: { frequency: "weekly", anchorDate: "2026-03-03" } },
      ],
    });
    expect(f.points).toHaveLength(7);
    const d3 = f.points.find((p) => p.date === "2026-03-03")!;
    expect(d3.expected).toBe(100_000 - 150_000 - 2 * 2_000); // day 2 of the forecast
    const d7 = f.points.at(-1)!;
    expect(d7.expected).toBe(100_000 - 150_000 + 250_000 - 7 * 2_000);
    expect(d7.conservative).toBeLessThan(d7.expected);
    expect(d7.optimistic).toBeGreaterThan(d7.expected);
    expect(f.shortfall).toEqual({ date: "2026-03-03", scenario: "expected" });
    expect(f.lowest.date).toBe("2026-03-04");
  });

  it("does not double count occurrences already matched to transactions", () => {
    const f = forecastCashFlow({
      today: "2026-03-01",
      days: 3,
      startBalance: 0,
      variable: { ...variable, dailyExpected: 0, dailyConservative: 0, dailyOptimistic: 0 },
      flows: [{ amount: -1_000, label: "Bill", source: "recurring", rule: { frequency: "weekly", anchorDate: "2026-03-02" }, settledDates: ["2026-03-02"] }],
    });
    expect(f.endExpected).toBe(0);
  });

  it("estimates variable spending by weekly buckets and flags thin history", () => {
    const spends = Array.from({ length: 28 }, (_, i) => ({ date: addDays("2026-02-01", i), amount: 1_000 }));
    const e = estimateVariableSpending(spends, "2026-02-01", "2026-02-28");
    expect(e.weeksOfHistory).toBe(4);
    expect(e.dailyExpected).toBe(1_000);
    expect(e.sufficient).toBe(true);
    expect(estimateVariableSpending([], "2026-02-01", "2026-02-10").sufficient).toBe(false);
  });
});

describe("safe to spend", () => {
  it("subtracts bills before payday and the safety buffer, never adds future income", () => {
    const s = safeToSpend({
      today: "2026-03-01",
      spendableBalance: 120_000,
      nextPayday: "2026-03-06",
      fallbackHorizon: "2026-03-31",
      safetyBuffer: 10_000,
      events: [
        { date: "2026-03-03", amount: -40_000, label: "Power", source: "recurring" },
        { date: "2026-03-06", amount: -5_000, label: "Due on payday", source: "recurring" },
        { date: "2026-03-06", amount: 250_000, label: "Pay", source: "recurring" },
        { date: "2026-03-10", amount: -9_999, label: "After payday", source: "recurring" },
      ],
    });
    expect(s.committed).toBe(40_000);
    expect(s.amount).toBe(70_000);
    expect(s.perDay).toBe(14_000);
    expect(s.horizonKind).toBe("payday");
  });

  it("falls back to month end without recurring income", () => {
    const s = safeToSpend({ today: "2026-03-20", spendableBalance: 10_000, nextPayday: null, fallbackHorizon: "2026-03-31", safetyBuffer: 0, events: [] });
    expect(s.horizonKind).toBe("month_end");
    expect(s.daysUntilHorizon).toBe(11);
  });
});

describe("CSV", () => {
  it("parses quoted fields, escaped quotes, CRLF and BOM", () => {
    const rows = parseCsv('﻿Date,Description,Amount\r\n2026-03-01,"Coffee, ""flat white""",-4.50\r\n\r\n2026-03-02,Pay,2000\n');
    expect(rows).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-03-01", 'Coffee, "flat white"', "-4.50"],
      ["2026-03-02", "Pay", "2000"],
    ]);
  });

  it("neutralises formula injection in text cells but not numeric cells", () => {
    expect(escapeCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCell("-12.50", { numeric: true })).toBe("-12.50");
    const out = toCsv([{ a: "x,y", b: "-1.00" }], [{ header: "A", value: (r) => r.a }, { header: "B", value: (r) => r.b, numeric: true }]);
    expect(out).toBe('A,B\r\n"x,y",-1.00\r\n');
  });

  it("round-trips through parse", () => {
    const csv = toCsv([{ d: 'He said "hi"\nbye' }], [{ header: "D", value: (r) => r.d }]);
    expect(parseCsv(csv)[1][0]).toBe('He said "hi"\nbye');
  });
});

describe("bank CSV mapping", () => {
  it("parses NZ, US and ISO dates", () => {
    expect(parseDateWithFormat("05/03/2026", "DMY")).toBe("2026-03-05");
    expect(parseDateWithFormat("05/03/26", "DMY")).toBe("2026-03-05");
    expect(parseDateWithFormat("03/05/2026", "MDY")).toBe("2026-03-05");
    expect(parseDateWithFormat("2026-03-05", "DMY")).toBe("2026-03-05");
    expect(parseDateWithFormat("31/02/2026", "DMY")).toBeNull();
    expect(detectDateFormat(["13/01/2026", "01/02/2026"])).toBe("DMY");
    expect(detectDateFormat(["01/13/2026"])).toBe("MDY");
  });

  it("guesses an ANZ-style layout and maps rows", () => {
    const header = ["Type", "Details", "Particulars", "Code", "Reference", "Amount", "Date", "ForeignCurrencyAmount", "ConversionCharge"];
    const rows = [
      ["Eft-Pos", "COUNTDOWN PONSONBY", "4835****1234", "", "", "-82.15", "14/03/2026", "", ""],
      ["Salary", "ACME LTD", "", "", "PAY", "2,350.00", "15/03/2026", "", ""],
    ];
    const m = guessMapping(header, rows)!;
    expect(m.date).toBe(6);
    expect(m.description).toBe(1);
    expect(m.amount).toBe(5);
    expect(m.dateFormat).toBe("DMY");
    const mapped = mapRows(rows, m);
    expect(mapped[0]).toMatchObject({ date: "2026-03-14", amount: -8215, errors: [] });
    expect(mapped[1].amount).toBe(235000);
  });

  it("supports debit/credit columns and reports row errors", () => {
    const header = ["Date", "Description", "Debit", "Credit"];
    const rows = [
      ["2026-03-01", "Rent", "450.00", ""],
      ["2026-03-02", "Refund", "", "20.00"],
      ["bad", "", "x", ""],
    ];
    const m = guessMapping(header, rows)!;
    const mapped = mapRows(rows, m);
    expect(mapped[0].amount).toBe(-45000);
    expect(mapped[1].amount).toBe(2000);
    expect(mapped[2].errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("merchants and duplicates", () => {
  it("normalises noisy bank descriptions", () => {
    expect(normalizeMerchant("EFTPOS PURCHASE 4835-****-****-1234 COUNTDOWN PONSONBY AUCKLAND NZ 12/03").name).toBe("Countdown Ponsonby");
    expect(normalizeMerchant("SP * NETFLIX.COM").key).toBe("netflixcom");
    expect(normalizeMerchant("Z ENERGY 12345678 NEWMARKET").name).toBe("Z Energy Newmarket");
    // Macrons are kept for display but folded for matching.
    expect(normalizeMerchant("Kōwhai Design Ltd")).toEqual({ name: "Kōwhai Design Ltd", key: "kowhai design ltd" });
    expect(normalizeMerchant("KOWHAI DESIGN LTD").key).toBe("kowhai design ltd");
  });

  it("applies the most specific user rule", () => {
    const r = applyMerchantRules("COUNTDOWN METRO QUEEN ST", [
      { pattern: "countdown", categoryId: "groceries" },
      { pattern: "countdown metro", categoryId: "lunch" },
    ]);
    expect(r?.categoryId).toBe("lunch");
  });

  it("gives repeated identical rows distinct, stable fingerprints", () => {
    const rows = [
      { date: "2026-03-01", amount: -450, description: "Coffee" },
      { date: "2026-03-01", amount: -450, description: "Coffee" },
    ];
    const a = fingerprintRows("acc", rows);
    const b = fingerprintRows("acc", rows);
    expect(a[0].fingerprint).not.toBe(a[1].fingerprint);
    expect(a.map((r) => r.fingerprint)).toEqual(b.map((r) => r.fingerprint));
  });

  it("finds possible duplicates within a window but trusts distinct provider ids", () => {
    const pairs = findPossibleDuplicates([
      { id: "1", accountId: "a", date: "2026-03-01", amount: -999, merchantKey: "spotify" },
      { id: "2", accountId: "a", date: "2026-03-02", amount: -999, merchantKey: "spotify" },
      { id: "3", accountId: "a", date: "2026-03-10", amount: -999, merchantKey: "spotify" },
      { id: "4", accountId: "a", date: "2026-03-01", amount: -500, merchantKey: "cafe", externalId: "x1" },
      { id: "5", accountId: "a", date: "2026-03-01", amount: -500, merchantKey: "cafe", externalId: "x2" },
    ]);
    expect(pairs).toEqual([["1", "2"]]);
  });
});

describe("recurring detection", () => {
  it("detects a monthly subscription with a price change", () => {
    const dates = ["2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03"];
    const txns = dates.map((d, i) => ({
      id: `n${i}`,
      date: d,
      amount: i === 4 ? -2_799 : -2_499,
      merchantKey: "netflix",
      merchantName: "Netflix",
      categoryId: "subs",
      accountId: "card",
    }));
    const [p] = detectRecurring(txns, "2026-09-20");
    expect(p.frequency).toBe("monthly");
    expect(p.priceChange).toEqual({ from: -2_499, to: -2_799, date: "2026-09-03" });
    expect(p.annualCost).toBe(2_499 * 12);
    expect(p.occurrences).toBe(5);
  });

  it("ignores irregular merchants and stale patterns", () => {
    const irregular = ["2026-01-02", "2026-01-20", "2026-03-11", "2026-03-12"].map((d, i) => ({
      id: `x${i}`, date: d, amount: -1_000, merchantKey: "cafe", merchantName: "Cafe", categoryId: null, accountId: "a",
    }));
    expect(detectRecurring(irregular, "2026-03-20")).toEqual([]);
    const stale = ["2025-01-01", "2025-02-01", "2025-03-01"].map((d, i) => ({
      id: `s${i}`, date: d, amount: -1_000, merchantKey: "gym", merchantName: "Gym", categoryId: null, accountId: "a",
    }));
    expect(detectRecurring(stale, "2026-03-20")).toEqual([]);
  });

  it("annualises by frequency", () => {
    expect(annualise(1_000, "weekly")).toBe(52_000);
    expect(annualise(1_000, "fortnightly")).toBe(26_000);
    expect(annualise(1_000, "quarterly")).toBe(4_000);
  });
});
