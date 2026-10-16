/**
 * Money primitives.
 *
 * All monetary values are integers in the currency's minor unit (cents for NZD).
 * Values are JS numbers guarded to the safe-integer range (±9e15 minor units —
 * roughly ±90 trillion dollars), which keeps them JSON-friendly. Any operation that
 * multiplies or divides uses BigInt intermediates and an explicit rounding rule so
 * results are deterministic and never touched by binary floating point.
 */

export type Cents = number;
export type CurrencyCode = string;

export interface Money {
  amount: Cents;
  currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of minor units (got ${value})`);
  }
  return value;
}

export function add(...values: Cents[]): Cents {
  let total = 0;
  for (const v of values) total = assertCents(total + assertCents(v), "sum");
  return total;
}

export function sum(values: Iterable<Cents>): Cents {
  let total = 0;
  for (const v of values) total = assertCents(total + assertCents(v), "sum");
  return total;
}

export function negate(value: Cents): Cents {
  return value === 0 ? 0 : -assertCents(value);
}

export function abs(value: Cents): Cents {
  return Math.abs(assertCents(value));
}

export function min(a: Cents, b: Cents): Cents {
  return a < b ? a : b;
}

export function max(a: Cents, b: Cents): Cents {
  return a > b ? a : b;
}

/** Sum Money values, refusing to mix currencies. */
export function sumMoney(values: Money[], currency: CurrencyCode): Money {
  let total = 0;
  for (const v of values) {
    if (v.currency !== currency) {
      throw new MoneyError(`Cannot add ${v.currency} to ${currency} without a conversion`);
    }
    total = add(total, v.amount);
  }
  return { amount: total, currency };
}

/**
 * Divide two BigInts rounding half away from zero.
 * e.g. 5/2 → 3, -5/2 → -3, 4/3 → 1.
 */
export function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === BigInt(0)) throw new MoneyError("Division by zero");
  const negative = numerator < BigInt(0) !== denominator < BigInt(0);
  const n = numerator < BigInt(0) ? -numerator : numerator;
  const d = denominator < BigInt(0) ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * BigInt(2) >= d ? q + BigInt(1) : q;
  return negative ? -rounded : rounded;
}

/** amount × numerator ÷ denominator, rounded half away from zero. */
export function mulDiv(amount: Cents, numerator: number, denominator: number): Cents {
  assertCents(amount);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new MoneyError("mulDiv factors must be integers");
  }
  const result = divRoundHalfAwayFromZero(BigInt(amount) * BigInt(numerator), BigInt(denominator));
  return assertCents(Number(result), "mulDiv result");
}

/** Apply a rate expressed in basis points (1 bp = 0.01%). */
export function applyBasisPoints(amount: Cents, bps: number): Cents {
  return mulDiv(amount, bps, 10_000);
}

/** Integer division of money into n parts, rounding each part up (useful for "save at least"). */
export function divideCeil(amount: Cents, parts: number): Cents {
  assertCents(amount);
  if (!Number.isSafeInteger(parts) || parts <= 0) throw new MoneyError("parts must be a positive integer");
  const q = Math.trunc(amount / parts);
  return amount % parts === 0 ? q : amount > 0 ? q + 1 : q;
}

/**
 * Split `total` across `weights` so the parts always sum exactly to `total`
 * (largest-remainder method; ties go to the earliest index).
 */
export function allocate(total: Cents, weights: number[]): Cents[] {
  assertCents(total);
  if (weights.length === 0) throw new MoneyError("allocate needs at least one weight");
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    throw new MoneyError("weights must be non-negative integers");
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) throw new MoneyError("weights must not all be zero");
  const sign = total < 0 ? -1 : 1;
  const t = BigInt(Math.abs(total));
  const ws = BigInt(weightSum);
  const base = weights.map((w) => (t * BigInt(w)) / ws);
  const remainders = weights.map((w, i) => ({ i, r: (t * BigInt(w)) % ws }));
  let leftover = Number(t - base.reduce((a, b) => a + b, BigInt(0)));
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const parts = base.map((b) => Number(b));
  for (const { i } of remainders) {
    if (leftover <= 0) break;
    parts[i] += 1;
    leftover -= 1;
  }
  return parts.map((p) => (p === 0 ? 0 : p * sign));
}

const fractionDigitsCache = new Map<string, number>();

/** Number of minor-unit digits for an ISO-4217 currency (NZD → 2, JPY → 0). */
export function currencyDigits(currency: CurrencyCode): number {
  const cached = fractionDigitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    throw new MoneyError(`Unknown currency ${currency}`);
  }
  fractionDigitsCache.set(currency, digits);
  return digits;
}

/**
 * Parse a user- or CSV-supplied decimal string into minor units without floats.
 * Accepts "1234.5", "-1,234.56", "$12", "(12.00)" (accounting negative), "12.00 CR"/"DR".
 * Rejects more fractional digits than the currency allows unless they are zeros.
 */
export function parseAmount(input: string, currency: CurrencyCode = "NZD"): Cents {
  const digits = currencyDigits(currency);
  let s = input.trim();
  if (!s) throw new MoneyError("Amount is empty");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  const suffix = s.match(/\s*(CR|DR)$/i);
  if (suffix) {
    if (suffix[1].toUpperCase() === "DR") negative = !negative;
    s = s.slice(0, suffix.index).trim();
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }
  s = s.replace(/^[A-Z]{3}\s*/i, "").replace(/^[^\d.,]+/, "");
  if (s.endsWith("-")) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/[,\s_]/g, "");
  if (!/^\d+(\.\d+)?$/.test(s) && !/^\.\d+$/.test(s)) {
    throw new MoneyError(`"${input}" is not a valid amount`);
  }
  const [wholeRaw, fracRaw = ""] = s.split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  let frac = fracRaw;
  if (frac.length > digits) {
    if (/[^0]/.test(frac.slice(digits))) {
      throw new MoneyError(`"${input}" has more than ${digits} decimal places`);
    }
    frac = frac.slice(0, digits);
  }
  frac = frac.padEnd(digits, "0");
  const value = BigInt(whole) * BigInt(10) ** BigInt(digits) + BigInt(frac === "" ? "0" : frac);
  const n = Number(negative ? -value : value);
  return assertCents(n === 0 ? 0 : n);
}

/** Minor units → plain decimal string ("-1234.50"). Exact. */
export function toDecimalString(amount: Cents, currency: CurrencyCode = "NZD"): string {
  assertCents(amount);
  const digits = currencyDigits(currency);
  const negative = amount < 0;
  const s = Math.abs(amount).toString().padStart(digits + 1, "0");
  const whole = digits === 0 ? s : s.slice(0, -digits);
  const frac = digits === 0 ? "" : "." + s.slice(-digits);
  return `${negative ? "-" : ""}${whole}${frac}`;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

export interface FormatOptions {
  locale?: string;
  /** Show "+" for positive values. */
  signed?: boolean;
  /** Drop the minor unit when it's zero (e.g. "$1,200"). */
  compact?: boolean;
}

/**
 * Format minor units for display. Formatting goes through the exact decimal string,
 * so no floating-point rounding can change the displayed value.
 */
export function formatMoney(amount: Cents, currency: CurrencyCode = "NZD", opts: FormatOptions = {}): string {
  const locale = opts.locale ?? "en-NZ";
  const digits = currencyDigits(currency);
  const showFraction = !(opts.compact && amount % 10 ** digits === 0);
  const key = `${locale}|${currency}|${showFraction}|${opts.signed}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: showFraction ? digits : 0,
      maximumFractionDigits: showFraction ? digits : 0,
      signDisplay: opts.signed ? "exceptZero" : "auto",
    });
    formatterCache.set(key, fmt);
  }
  // Intl accepts decimal strings exactly (ES2023 "Intl.NumberFormat v3").
  return fmt.format(toDecimalString(amount, currency) as unknown as number);
}

/** Ratio as basis points (e.g. 0.2534 → 2534), rounded; null when denominator is 0. */
export function ratioBps(numerator: Cents, denominator: Cents): number | null {
  if (denominator === 0) return null;
  return Number(divRoundHalfAwayFromZero(BigInt(numerator) * BigInt(10_000), BigInt(denominator)));
}

export function formatBps(bps: number | null, fractionDigits = 0): string {
  if (bps === null) return "—";
  return `${(bps / 100).toFixed(fractionDigits)}%`;
}
