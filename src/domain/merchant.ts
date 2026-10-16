/**
 * Merchant normalisation: turn raw bank descriptions such as
 *   "EFTPOS PURCHASE 4835-****-****-1234 COUNTDOWN PONSONBY AUCKLAND NZ 12/03"
 * into a stable display name ("Countdown Ponsonby") and a matching key ("countdown ponsonby").
 *
 * User-defined merchant rules (pattern → name/category) take precedence and are
 * applied by the service layer before falling back to this heuristic.
 */

const PREFIXES = [
  /^(eftpos|pos|visa|debit|credit|card|contactless|paywave|apple pay|google pay)\s+(purchase|payment|transaction|txn)?\s*/i,
  /^(direct debit|automatic payment|ap|dd|bill payment|online payment|internet payment|bp|transfer( to| from)?)\s*[-:]?\s*/i,
  /^(sq \*|sp \*|paypal \*|pp\*|tst\*|sq\*|sp\*)/i,
];

const NOISE = [
  /\b\d{4}[-\s*x]{1,3}[\dx*]{4}[-\s*x]{1,3}[\dx*]{4}[-\s*x]{1,3}\d{4}\b/gi, // card numbers
  /\b[x*]{2,}\d{2,4}\b/gi, // masked cards
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, // dates
  /\b\d{1,2}:\d{2}(:\d{2})?\b/g, // times
  /\bref(erence)?[:\s]*\w+\b/gi,
  /\b(auckland|wellington|christchurch|hamilton|tauranga|dunedin|palmerston north|nelson|napier|hastings|queenstown|rotorua|new plymouth|whangarei|invercargill)\b/gi,
  /\b\d{5,}\b/g, // long numbers (store/terminal ids)
  /#\s?\d+/g,
  /[*]+/g,
];

const SMALL_WORDS = new Set(["and", "of", "the", "for", "&"]);

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function normalizeMerchant(raw: string): { name: string; key: string } {
  let s = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  for (const p of PREFIXES) s = s.replace(p, "");
  for (const n of NOISE) s = s.replace(n, " ");
  s = s.replace(/[_|]+/g, " ").replace(/\s{2,}/g, " ").replace(/[\s\-.,:;]+$/g, "").trim();
  s = s.replace(/\s+(nzl?|aus?|usa?|gbr?)$/i, "").trim(); // trailing country code
  if (!s) s = raw.trim();
  // Keep at most the first four words: branch suffixes vary, the brand doesn't.
  const words = s.split(" ").slice(0, 4);
  const name = titleCase(words.join(" "));
  // Fold diacritics (Kōwhai → kowhai) so te reo Māori and accented names match reliably.
  const key = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { name: name || raw.trim(), key: key || raw.trim().toLowerCase() };
}

/** A shorter key (first two words) used for grouping recurring merchants. */
export function merchantGroupKey(key: string): string {
  return key.split(" ").slice(0, 2).join(" ");
}

export interface MerchantRule {
  /** Case-insensitive substring matched against the raw description or merchant name. */
  pattern: string;
  merchantName?: string | null;
  categoryId?: string | null;
}

export function applyMerchantRules(raw: string, rules: MerchantRule[]): MerchantRule | null {
  const hay = raw.toLowerCase();
  // Longest pattern wins, so specific rules beat generic ones.
  const sorted = [...rules].sort((a, b) => b.pattern.length - a.pattern.length);
  return sorted.find((r) => r.pattern && hay.includes(r.pattern.toLowerCase())) ?? null;
}
