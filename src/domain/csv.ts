/**
 * RFC 4180 CSV parsing and writing.
 *
 * Writing neutralises spreadsheet formula injection: any text cell starting with
 * = + - @ (or tab / carriage return) is prefixed with a single quote, so opening an
 * export in Excel can't execute content that came from a merchant name or note.
 * Numeric money columns are written as plain decimals and are not prefixed.
 */

export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  // Strip UTF-8 BOM.
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (inQuotes) throw new Error("CSV has an unterminated quoted field");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully empty lines.
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 1 ? counts[0][0] : ",";
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function escapeCell(value: string | number | null | undefined, opts: { numeric?: boolean } = {}): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (!opts.numeric && FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  numeric?: boolean;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => escapeCell(c.value(r), { numeric: c.numeric })).join(","));
  return lines.join("\r\n") + "\r\n";
}
