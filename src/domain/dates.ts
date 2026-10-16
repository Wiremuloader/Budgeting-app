/**
 * Civil (calendar) dates as "YYYY-MM-DD" strings.
 *
 * Financial dates are calendar days, not instants: a transaction on 2026-03-31 in
 * Auckland is on the 31st no matter where the server runs. We therefore never use
 * `Date` arithmetic for them. The only timezone-aware operation is `todayIn`, which
 * resolves "today" for the user's IANA timezone.
 */

export type ISODate = string; // YYYY-MM-DD
export type MonthKey = string; // YYYY-MM

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export function parseDate(s: ISODate): CivilDate {
  const m = DATE_RE.exec(s);
  if (!m) throw new RangeError(`Invalid date "${s}"`);
  const year = +m[1];
  const month = +m[2];
  const day = +m[3];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Invalid date "${s}"`);
  }
  return { year, month, day };
}

export function isValidDate(s: string): boolean {
  try {
    parseDate(s);
    return true;
  } catch {
    return false;
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatDate({ year, month, day }: CivilDate): ISODate {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** Days since 1970-01-01 (Howard Hinnant's days_from_civil). */
export function toDayNumber(s: ISODate): number {
  const { year, month, day } = parseDate(s);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(z: number): ISODate {
  const zz = z + 719468;
  const era = Math.floor(zz / 146097);
  const doe = zz - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return formatDate({ year, month, day });
}

export function addDays(s: ISODate, n: number): ISODate {
  return fromDayNumber(toDayNumber(s) + n);
}

/** b − a in days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(s: ISODate): number {
  return (((toDayNumber(s) + 4) % 7) + 7) % 7;
}

/**
 * Add calendar months, clamping the day to the target month's length
 * (2026-01-31 + 1 month → 2026-02-28). Pass `preferredDay` to keep a schedule's
 * original day across short months (Jan 31 → Feb 28 → Mar 31).
 */
export function addMonths(s: ISODate, n: number, preferredDay?: number): ISODate {
  const { year, month, day } = parseDate(s);
  const index = year * 12 + (month - 1) + n;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const d = Math.min(preferredDay ?? day, daysInMonth(y, m));
  return formatDate({ year: y, month: m, day: d });
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0; // lexical order == chronological order for ISO dates
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function monthKey(s: ISODate): MonthKey {
  return s.slice(0, 7);
}

export function parseMonthKey(k: MonthKey): { year: number; month: number } {
  const m = MONTH_RE.exec(k);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new RangeError(`Invalid month "${k}"`);
  return { year: +m[1], month: +m[2] };
}

export function isValidMonthKey(k: string): boolean {
  try {
    parseMonthKey(k);
    return true;
  } catch {
    return false;
  }
}

export function monthStart(k: MonthKey): ISODate {
  parseMonthKey(k);
  return `${k}-01`;
}

export function monthEnd(k: MonthKey): ISODate {
  const { year, month } = parseMonthKey(k);
  return `${k}-${pad2(daysInMonth(year, month))}`;
}

export function addMonthKey(k: MonthKey, n: number): MonthKey {
  return monthKey(addMonths(monthStart(k), n));
}

/** Inclusive list of month keys from a to b. */
export function monthRange(a: MonthKey, b: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let k = a; k <= b; k = addMonthKey(k, 1)) out.push(k);
  return out;
}

export function daysInMonthKey(k: MonthKey): number {
  const { year, month } = parseMonthKey(k);
  return daysInMonth(year, month);
}

/** Inclusive number of days in [from, to]. */
export function daysInclusive(from: ISODate, to: ISODate): number {
  return diffDays(from, to) + 1;
}

/** Today's calendar date in an IANA timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface DateRange {
  from: ISODate;
  to: ISODate; // inclusive
}

export function monthRangeOf(k: MonthKey): DateRange {
  return { from: monthStart(k), to: monthEnd(k) };
}

/** The range of equal length immediately before `r`. */
export function previousRange(r: DateRange): DateRange {
  const len = daysInclusive(r.from, r.to);
  // Whole calendar months compare against the previous whole month(s).
  if (r.from.endsWith("-01") && r.to === monthEnd(monthKey(r.to))) {
    const months = monthRange(monthKey(r.from), monthKey(r.to)).length;
    const startKey = addMonthKey(monthKey(r.from), -months);
    return { from: monthStart(startKey), to: monthEnd(addMonthKey(monthKey(r.from), -1)) };
  }
  return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
}

export function inRange(d: ISODate, r: DateRange): boolean {
  return d >= r.from && d <= r.to;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatMonthKey(k: MonthKey, style: "short" | "long" = "long"): string {
  const { year, month } = parseMonthKey(k);
  return `${(style === "long" ? MONTH_LONG : MONTH_NAMES)[month - 1]} ${year}`;
}

export function formatDisplayDate(s: ISODate, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const { year, month, day } = parseDate(s);
  const w = opts.weekday ? `${DAY_NAMES[dayOfWeek(s)]} ` : "";
  return `${w}${day} ${MONTH_NAMES[month - 1]}${opts.year ? ` ${year}` : ""}`;
}

export function shortMonth(k: MonthKey): string {
  return MONTH_NAMES[parseMonthKey(k).month - 1];
}
