/**
 * Structured JSON logger.
 *
 * Never log money amounts, merchant names, notes, emails, tokens or request bodies.
 * Log ids, counts, durations and error classes. `redact` strips known sensitive keys
 * defensively in case a caller passes an object through.
 */

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE = /pass(word)?|token|secret|authorization|cookie|email|amount|balance|merchant|note|description|credential|api[-_]?key/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function threshold(): number {
  const l = (process.env.LOG_LEVEL ?? "info") as Level;
  return ORDER[l] ?? ORDER.info;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const entry = { level, time: new Date().toISOString(), msg, ...(fields ? (redact(fields) as object) : {}) };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};

export function errorFields(e: unknown): Record<string, unknown> {
  if (e instanceof Error) return { errorName: e.name, errorMessage: e.message.slice(0, 300) };
  return { errorName: typeof e };
}
