import { describe, expect, it } from "vitest";
import {
  add,
  allocate,
  applyBasisPoints,
  assertCents,
  divideCeil,
  divRoundHalfAwayFromZero,
  formatMoney,
  mulDiv,
  parseAmount,
  ratioBps,
  sum,
  sumMoney,
  toDecimalString,
} from "@/domain/money";

describe("money arithmetic", () => {
  it("adds integer cents exactly where floats would drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the reason we use minor units
    expect(add(10, 20)).toBe(30);
    expect(sum([1999, 1, -2000])).toBe(0);
  });

  it("rejects non-integer amounts", () => {
    expect(() => assertCents(1.5)).toThrow();
    expect(() => add(1, 0.1)).toThrow();
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });

  it("rounds half away from zero", () => {
    expect(divRoundHalfAwayFromZero(BigInt(5), BigInt(2))).toBe(BigInt(3));
    expect(divRoundHalfAwayFromZero(BigInt(-5), BigInt(2))).toBe(BigInt(-3));
    expect(divRoundHalfAwayFromZero(BigInt(4), BigInt(3))).toBe(BigInt(1));
    expect(mulDiv(100, 1, 3)).toBe(33);
    expect(mulDiv(-250, 1, 100)).toBe(-3);
  });

  it("applies basis-point rates", () => {
    expect(applyBasisPoints(100_000, 1995)).toBe(19_950); // 19.95 % of $1,000
    expect(applyBasisPoints(333, 5000)).toBe(167); // 166.5 → 167
  });

  it("allocates so parts always sum to the total", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    const parts = allocate(123_457, [40, 15, 12, 8, 25]);
    expect(sum(parts)).toBe(123_457);
    expect(() => allocate(10, [0, 0])).toThrow();
  });

  it("divides rounding up for 'save at least' figures", () => {
    expect(divideCeil(1000, 3)).toBe(334);
    expect(divideCeil(900, 3)).toBe(300);
  });

  it("refuses to sum mixed currencies", () => {
    expect(() =>
      sumMoney([{ amount: 1, currency: "NZD" }, { amount: 1, currency: "AUD" }], "NZD"),
    ).toThrow(/conversion/);
    expect(sumMoney([{ amount: 1, currency: "NZD" }, { amount: 2, currency: "NZD" }], "NZD").amount).toBe(3);
  });

  it("computes ratios in basis points", () => {
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(5, 0)).toBeNull();
  });
});

describe("parseAmount", () => {
  it.each([
    ["12", 1200],
    ["12.5", 1250],
    ["-1,234.56", -123456],
    ["$45.00", 4500],
    ["(12.00)", -1200],
    ["12.00 DR", -1200],
    ["12.00 CR", 1200],
    ["NZD 7.10", 710],
    [".99", 99],
    ["+3", 300],
    ["1.230", 123],
    ["0", 0],
    ["-0.00", 0],
  ])("parses %s", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it.each(["", "abc", "1.234", "1..2", "12,34.5.6"])("rejects %s", (input) => {
    expect(() => parseAmount(input)).toThrow();
  });

  it("respects zero-decimal currencies", () => {
    expect(parseAmount("1500", "JPY")).toBe(1500);
    expect(() => parseAmount("1500.5", "JPY")).toThrow();
  });
});

describe("formatting", () => {
  it("formats via exact decimal strings", () => {
    expect(toDecimalString(-123456)).toBe("-1234.56");
    expect(toDecimalString(5)).toBe("0.05");
    expect(formatMoney(123456, "NZD")).toBe("$1,234.56");
    expect(formatMoney(-500, "NZD")).toBe("-$5.00");
    expect(formatMoney(120000, "NZD", { compact: true })).toBe("$1,200");
    expect(formatMoney(2500, "NZD", { signed: true })).toBe("+$25.00");
  });
});
