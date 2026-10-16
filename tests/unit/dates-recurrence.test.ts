import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dayOfWeek,
  diffDays,
  fromDayNumber,
  monthEnd,
  monthRange,
  previousRange,
  toDayNumber,
  todayIn,
} from "@/domain/dates";
import { nextOccurrence, occurrencesBetween, previousOccurrence } from "@/domain/recurrence";

describe("civil dates", () => {
  it("round-trips day numbers across centuries", () => {
    for (const d of ["1970-01-01", "2000-02-29", "2026-12-31", "1899-03-01", "2400-02-29"]) {
      expect(fromDayNumber(toDayNumber(d))).toBe(d);
    }
    expect(toDayNumber("1970-01-01")).toBe(0);
  });

  it("handles leap years and month ends", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(monthEnd("2100-02")).toBe("2100-02-28");
    expect(diffDays("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("clamps month addition and can restore the preferred day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 2, 31)).toBe("2026-03-31");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  });

  it("knows weekdays", () => {
    expect(dayOfWeek("2026-10-16")).toBe(5); // Friday
  });

  it("resolves today in the user's timezone, not the server's", () => {
    // 2026-10-16T11:30Z is the evening of the 16th in Auckland (UTC+13 DST) → 17th.
    const instant = new Date("2026-10-16T11:30:00Z");
    expect(todayIn("Pacific/Auckland", instant)).toBe("2026-10-17");
    expect(todayIn("America/Los_Angeles", instant)).toBe("2026-10-16");
  });

  it("computes previous comparison ranges", () => {
    expect(previousRange({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousRange({ from: "2026-01-01", to: "2026-03-31" })).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(previousRange({ from: "2026-03-10", to: "2026-03-16" })).toEqual({ from: "2026-03-03", to: "2026-03-09" });
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("recurrence", () => {
  it("monthly on the 31st follows month ends and returns to the 31st", () => {
    const rule = { frequency: "monthly" as const, anchorDate: "2026-01-31" };
    expect(occurrencesBetween(rule, "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("fortnightly pay steps exactly 14 days", () => {
    const rule = { frequency: "fortnightly" as const, anchorDate: "2026-01-08" };
    const occ = occurrencesBetween(rule, "2026-03-01", "2026-03-31");
    expect(occ).toEqual(["2026-03-05", "2026-03-19"]);
    expect(nextOccurrence(rule, "2026-03-06")).toBe("2026-03-19");
    expect(previousOccurrence(rule, "2026-03-18")).toBe("2026-03-05");
  });

  it("respects anchor and end dates", () => {
    const rule = { frequency: "weekly" as const, anchorDate: "2026-02-02", endDate: "2026-02-20" };
    expect(occurrencesBetween(rule, "2026-01-01", "2026-12-31")).toEqual(["2026-02-02", "2026-02-09", "2026-02-16"]);
    expect(nextOccurrence(rule, "2026-02-21")).toBeNull();
  });

  it("yearly on 29 Feb falls back to 28 Feb in common years", () => {
    const rule = { frequency: "yearly" as const, anchorDate: "2028-02-29" };
    expect(occurrencesBetween(rule, "2028-01-01", "2032-12-31")).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
      "2031-02-28",
      "2032-02-29",
    ]);
  });

  it("supports custom intervals", () => {
    const rule = { frequency: "custom" as const, interval: 10, unit: "day" as const, anchorDate: "2026-01-01" };
    expect(occurrencesBetween(rule, "2026-01-01", "2026-01-31")).toEqual(["2026-01-01", "2026-01-11", "2026-01-21", "2026-01-31"]);
    const q = { frequency: "custom" as const, interval: 2, unit: "month" as const, anchorDate: "2025-12-15" };
    expect(occurrencesBetween(q, "2026-01-01", "2026-06-30")).toEqual(["2026-02-15", "2026-04-15", "2026-06-15"]);
  });

  it("jumps efficiently for distant windows", () => {
    const rule = { frequency: "weekly" as const, anchorDate: "2000-01-03" };
    expect(occurrencesBetween(rule, "2026-10-12", "2026-10-18")).toHaveLength(1);
  });
});
