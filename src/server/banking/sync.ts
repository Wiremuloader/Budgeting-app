import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db";
import { bankConnections, financialAccounts, transactions } from "../db/schema";
import { audit } from "../services/common";
import { createTransactionTx } from "../services/transactions";
import { decryptSecret } from "./crypto";
import { getProvider, ProviderError, type ProviderTransaction } from "./provider";
import { log, errorFields } from "../log";
import { addDays, type ISODate } from "@/domain/dates";
import { normalizeMerchant } from "@/domain/merchant";

/**
 * Provider-agnostic sync engine.
 *
 *  - Idempotent: transactions are keyed by (account, externalId); re-running a page
 *    inserts nothing new.
 *  - Pending → posted: a posted transaction that replaces a pending one updates the
 *    existing row (amount/date/status) instead of creating a second one, preserving
 *    the user's category and notes.
 *  - Removed pending transactions are deleted only while still pending.
 *  - Consent expiry/revocation stops syncing and marks the connection for re-consent.
 *  - Transient failures back off exponentially (max 6 hours).
 */

export interface SyncSummary {
  inserted: number;
  updated: number;
  removed: number;
  status: "ok" | "needs_consent" | "retry_later" | "error";
}

export function nextRetryDelayMinutes(failures: number): number {
  return Math.min(2 ** Math.max(failures - 1, 0) * 5, 360);
}

export async function applyProviderTransactions(
  db: Database,
  userId: string,
  accountMap: Map<string, string>,
  page: { transactions: ProviderTransaction[]; removedExternalIds: string[] },
): Promise<Omit<SyncSummary, "status">> {
  let inserted = 0;
  let updated = 0;
  let removed = 0;
  await db.transaction(async (tx) => {
    for (const p of page.transactions) {
      const accountId = accountMap.get(p.externalAccountId);
      if (!accountId) continue;
      const lookupIds = [p.externalId, ...(p.replacesExternalId ? [p.replacesExternalId] : [])];
      const [existing] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.accountId, accountId), inArray(transactions.externalId, lookupIds)));
      const status = p.status === "pending" ? "pending" : "cleared";
      if (existing) {
        if (existing.status === "reconciled") continue;
        if (existing.amount !== p.amount || existing.date !== p.date || existing.status !== status || existing.externalId !== p.externalId) {
          await tx
            .update(transactions)
            .set({ amount: p.amount, date: p.date, status, externalId: p.externalId })
            .where(eq(transactions.id, existing.id));
          updated++;
        }
        continue;
      }
      await createTransactionTx(
        tx,
        userId,
        {
          accountId,
          date: p.date,
          amount: p.amount,
          merchant: p.merchantName || normalizeMerchant(p.description).name,
          description: p.description,
          status,
          reviewed: false,
          externalId: p.externalId,
        },
        "provider",
      );
      inserted++;
    }
    if (page.removedExternalIds.length) {
      const del = await tx
        .delete(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.status, "pending"), inArray(transactions.externalId, page.removedExternalIds)))
        .returning({ id: transactions.id });
      removed = del.length;
    }
  });
  return { inserted, updated, removed };
}

export async function syncConnection(db: Database, userId: string, connectionId: string, today: ISODate): Promise<SyncSummary> {
  const [conn] = await db.select().from(bankConnections).where(and(eq(bankConnections.id, connectionId), eq(bankConnections.userId, userId)));
  if (!conn) throw new Error("Connection not found");
  const provider = getProvider(conn.provider);
  if (!provider || !provider.isConfigured() || !conn.encryptedCredentials) {
    await db.update(bankConnections).set({ status: "error", lastError: "Provider not available" }).where(eq(bankConnections.id, conn.id));
    return { inserted: 0, updated: 0, removed: 0, status: "error" };
  }
  if (conn.consentExpiresAt && conn.consentExpiresAt < new Date()) {
    await db.update(bankConnections).set({ status: "expired" }).where(eq(bankConnections.id, conn.id));
    return { inserted: 0, updated: 0, removed: 0, status: "needs_consent" };
  }
  const accounts = await db.select({ id: financialAccounts.id, ext: financialAccounts.externalAccountId }).from(financialAccounts).where(and(eq(financialAccounts.userId, userId), eq(financialAccounts.connectionId, conn.id)));
  const accountMap = new Map(accounts.filter((a) => a.ext).map((a) => [a.ext!, a.id]));
  const totals = { inserted: 0, updated: 0, removed: 0 };
  let cursor = conn.syncCursor;
  try {
    const credentials = decryptSecret(conn.encryptedCredentials);
    for (let i = 0; i < 50; i++) {
      const page = await provider.fetchTransactions(credentials, cursor, addDays(today, -90));
      const r = await applyProviderTransactions(db, userId, accountMap, page);
      totals.inserted += r.inserted;
      totals.updated += r.updated;
      totals.removed += r.removed;
      cursor = page.nextCursor;
      await db.update(bankConnections).set({ syncCursor: cursor }).where(eq(bankConnections.id, conn.id));
      if (!page.hasMore) break;
    }
    await db.update(bankConnections).set({ status: "active", lastSyncedAt: new Date(), lastError: null, failureCount: 0, nextRetryAt: null }).where(eq(bankConnections.id, conn.id));
    await audit(db, userId, "bank_connection", conn.id, "sync", totals, "provider");
    return { ...totals, status: "ok" };
  } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : "unknown";
    log.warn("banking.sync_failed", { provider: conn.provider, kind, ...errorFields(e) });
    if (kind === "consent_expired" || kind === "consent_revoked") {
      await db.update(bankConnections).set({ status: kind === "consent_expired" ? "expired" : "revoked", lastError: "Consent needs renewing" }).where(eq(bankConnections.id, conn.id));
      return { ...totals, status: "needs_consent" };
    }
    const failures = conn.failureCount + 1;
    const retryMs = (e instanceof ProviderError && e.retryAfterSeconds ? e.retryAfterSeconds * 1000 : nextRetryDelayMinutes(failures) * 60_000);
    await db
      .update(bankConnections)
      .set({ status: "error", lastError: kind === "unavailable" ? "The provider is temporarily unavailable" : "Sync failed", failureCount: failures, nextRetryAt: new Date(Date.now() + retryMs) })
      .where(eq(bankConnections.id, conn.id));
    return { ...totals, status: "retry_later" };
  }
}
