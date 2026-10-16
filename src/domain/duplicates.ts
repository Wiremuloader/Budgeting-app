import { diffDays, type ISODate } from "./dates";
import type { Cents } from "./money";

/**
 * Duplicate detection.
 *
 * Exact fingerprint (idempotent imports): account + date + amount + normalised
 * description + occurrence index. The occurrence index distinguishes two genuine
 * identical purchases on the same day within one file (two $4.50 coffees), while
 * re-importing the same file produces the same fingerprints and is skipped.
 *
 * Fuzzy "possible duplicate" detection (for review, never auto-deleted): same
 * account, same amount, merchant key equal, dates within `windowDays`.
 */

export function normalizeForFingerprint(description: string): string {
  return description.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function fingerprint(accountId: string, date: ISODate, amount: Cents, description: string, occurrence = 0): string {
  return [accountId, date, amount, normalizeForFingerprint(description), occurrence].join("|");
}

/** Assign occurrence indexes to rows that would otherwise share a fingerprint. */
export function fingerprintRows<T extends { date: ISODate; amount: Cents; description: string }>(
  accountId: string,
  rows: T[],
): (T & { fingerprint: string })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = fingerprint(accountId, r.date, r.amount, r.description);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { ...r, fingerprint: n === 0 ? base : fingerprint(accountId, r.date, r.amount, r.description, n) };
  });
}

export interface DupCandidate {
  id: string;
  accountId: string;
  date: ISODate;
  amount: Cents;
  merchantKey: string;
  externalId?: string | null;
}

export function findPossibleDuplicates(txns: DupCandidate[], windowDays = 2): [string, string][] {
  const pairs: [string, string][] = [];
  const groups = new Map<string, DupCandidate[]>();
  for (const t of txns) {
    const k = `${t.accountId}|${t.amount}|${t.merchantKey}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (diffDays(list[i].date, list[j].date) > windowDays) break;
        // Distinct provider ids mean the bank says these are different transactions.
        if (list[i].externalId && list[j].externalId && list[i].externalId !== list[j].externalId) continue;
        pairs.push([list[i].id, list[j].id]);
      }
    }
  }
  return pairs;
}
