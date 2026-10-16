import { add, MoneyError, parseAmount, type Cents } from "./money";
import { formatDate, isValidDate, type ISODate } from "./dates";

/**
 * Bank-statement CSV mapping.
 *
 * Supported layouts (see docs/CSV_FORMATS.md):
 *  - single signed amount column (most NZ banks), or
 *  - separate debit and credit columns (debits are outflows).
 * Date formats: YYYY-MM-DD, DD/MM/YYYY (NZ default), MM/DD/YYYY, with / - . separators
 * and 2-digit years (interpreted as 20xx).
 */

export type DateFormat = "YMD" | "DMY" | "MDY";

export interface ColumnMapping {
  date: number;
  description: number;
  /** Optional additional columns joined into the description (e.g. ANZ "Particulars", "Code"). */
  descriptionExtra?: number[];
  amount?: number;
  debit?: number;
  credit?: number;
  payee?: number;
  reference?: number;
  notes?: number;
  category?: number;
  externalId?: number;
  dateFormat: DateFormat;
  /** Multiply amounts by −1 (for card exports that show purchases as positive). */
  invertAmounts?: boolean;
}

export interface MappedRow {
  rowNumber: number; // 1-based, excluding header
  date: ISODate | null;
  description: string;
  payee: string | null;
  amount: Cents | null;
  reference: string | null;
  notes: string | null;
  category: string | null;
  externalId: string | null;
  errors: string[];
}

export function parseDateWithFormat(raw: string, format: DateFormat): ISODate | null {
  const s = raw.trim().split(/[ T]/)[0];
  const parts = s.split(/[/\-.]/);
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  let y: number, m: number, d: number;
  if (format === "YMD" || parts[0].length === 4) [y, m, d] = parts.map(Number);
  else if (format === "DMY") [d, m, y] = parts.map(Number);
  else [m, d, y] = parts.map(Number);
  if (y < 100) y += 2000;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidDate(iso) ? formatDate({ year: y, month: m, day: d }) : null;
}

/** Guess the date format from sample values: any first part > 12 ⇒ DMY, any second part > 12 ⇒ MDY. */
export function detectDateFormat(samples: string[]): DateFormat {
  let dmy = false;
  let mdy = false;
  for (const raw of samples) {
    const parts = raw.trim().split(/[ T]/)[0].split(/[/\-.]/);
    if (parts.length !== 3) continue;
    if (parts[0].length === 4) return "YMD";
    if (+parts[0] > 12) dmy = true;
    if (+parts[1] > 12) mdy = true;
  }
  if (mdy && !dmy) return "MDY";
  return "DMY"; // NZ default when ambiguous
}

const HEADER_HINTS: Record<keyof Omit<ColumnMapping, "dateFormat" | "invertAmounts" | "descriptionExtra">, RegExp> = {
  date: /^(transaction |posted |processed )?date$/i,
  description: /^(description|details|transaction details|narrative|memo|particulars)$/i,
  amount: /^(amount|value|amount \(nzd\)|transaction amount)$/i,
  debit: /^(debit|withdrawals?|money out|paid out)( amount)?$/i,
  credit: /^(credit|deposits?|money in|paid in)( amount)?$/i,
  payee: /^(payee|other party|merchant|name|counterparty)$/i,
  reference: /^(reference|ref|code)$/i,
  notes: /^(notes?|comments?)$/i,
  category: /^category$/i,
  externalId: /^(unique id|transaction id|id|fitid)$/i,
};

export function guessMapping(header: string[], sampleRows: string[][]): ColumnMapping | null {
  const find = (re: RegExp, exclude: number[] = []) =>
    header.findIndex((h, i) => !exclude.includes(i) && re.test(h.trim()));
  const date = find(HEADER_HINTS.date);
  const payee = find(HEADER_HINTS.payee);
  let description = find(HEADER_HINTS.description);
  if (description === -1) description = payee;
  if (date === -1 || description === -1) return null;
  const amount = find(HEADER_HINTS.amount);
  const debit = find(HEADER_HINTS.debit);
  const credit = find(HEADER_HINTS.credit);
  if (amount === -1 && (debit === -1 || credit === -1)) return null;
  const extras = header
    .map((h, i) => ({ h: h.trim().toLowerCase(), i }))
    .filter(({ h, i }) => ["particulars", "code"].includes(h) && i !== description)
    .map(({ i }) => i);
  const opt = (i: number) => (i === -1 ? undefined : i);
  return {
    date,
    description,
    descriptionExtra: extras.length ? extras : undefined,
    amount: opt(amount),
    debit: amount === -1 ? opt(debit) : undefined,
    credit: amount === -1 ? opt(credit) : undefined,
    payee: payee !== description ? opt(payee) : undefined,
    reference: opt(find(HEADER_HINTS.reference, extras)),
    notes: opt(find(HEADER_HINTS.notes)),
    category: opt(find(HEADER_HINTS.category)),
    externalId: opt(find(HEADER_HINTS.externalId)),
    dateFormat: detectDateFormat(sampleRows.map((r) => r[date] ?? "")),
  };
}

function cell(row: string[], i: number | undefined): string {
  return i === undefined ? "" : (row[i] ?? "").trim();
}

export function mapRows(rows: string[][], mapping: ColumnMapping, currency = "NZD"): MappedRow[] {
  return rows.map((row, idx) => {
    const errors: string[] = [];
    const rawDate = cell(row, mapping.date);
    const date = parseDateWithFormat(rawDate, mapping.dateFormat);
    if (!date) errors.push(`Unrecognised date "${rawDate}"`);

    const parts = [cell(row, mapping.description), ...(mapping.descriptionExtra ?? []).map((i) => cell(row, i))].filter(Boolean);
    const payee = cell(row, mapping.payee) || null;
    const description = [...new Set(parts)].join(" ") || payee || "";
    if (!description) errors.push("Missing description");

    let amount: Cents | null = null;
    try {
      if (mapping.amount !== undefined) {
        amount = parseAmount(cell(row, mapping.amount), currency);
      } else {
        const debitRaw = cell(row, mapping.debit);
        const creditRaw = cell(row, mapping.credit);
        const debit = debitRaw ? Math.abs(parseAmount(debitRaw, currency)) : 0;
        const credit = creditRaw ? Math.abs(parseAmount(creditRaw, currency)) : 0;
        if (!debitRaw && !creditRaw) throw new MoneyError("Missing amount");
        amount = add(credit, -debit);
      }
      if (amount !== null && mapping.invertAmounts) amount = amount === 0 ? 0 : -amount;
      if (amount === 0) errors.push("Amount is zero");
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Invalid amount");
      amount = null;
    }

    return {
      rowNumber: idx + 1,
      date,
      description,
      payee,
      amount,
      reference: cell(row, mapping.reference) || null,
      notes: cell(row, mapping.notes) || null,
      category: cell(row, mapping.category) || null,
      externalId: cell(row, mapping.externalId) || null,
      errors,
    };
  });
}
