import type { ISODate } from "@/domain/dates";

/**
 * Bank-connection provider interface.
 *
 * Ledger's finance engine never talks to a bank directly. A provider adapter
 * (e.g. an NZ open-banking aggregator) implements this interface; the sync engine
 * (./sync.ts) turns its output into ledger transactions idempotently.
 *
 * Rules for every adapter:
 *  - Use the provider's supported consent/authorisation flow (redirect/OAuth).
 *    Never collect online-banking passwords or PINs in Ledger.
 *  - Return stable `externalId`s so re-syncs are idempotent.
 *  - Report pending transactions as pending; when they post, return the posted
 *    version with `replacesExternalId` set to the pending id when the provider links them.
 *  - Throw ProviderError with an accurate `kind` so the engine can retry or ask for re-consent.
 */

export interface ProviderAccount {
  externalAccountId: string;
  name: string;
  type: "checking" | "savings" | "credit_card" | "loan" | "other_asset" | "other_liability";
  currency: string;
  mask?: string | null;
  balance?: number | null; // minor units, provider-reported
}

export interface ProviderTransaction {
  externalId: string;
  externalAccountId: string;
  date: ISODate;
  amount: number; // signed minor units from the account's point of view
  description: string;
  merchantName?: string | null;
  status: "pending" | "posted";
  replacesExternalId?: string | null;
}

export interface SyncPage {
  transactions: ProviderTransaction[];
  /** Ids the provider says were removed (e.g. pending that dropped off). */
  removedExternalIds: string[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type ProviderErrorKind = "consent_expired" | "consent_revoked" | "rate_limited" | "unavailable" | "invalid_response" | "unknown";

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ConsentStart {
  redirectUrl: string;
  state: string;
}

export interface BankingProvider {
  id: string;
  displayName: string;
  /** Country codes and institutions this provider supports — coverage differs by provider. */
  coverage: { country: string; institutions: string[] | "provider-listed" }[];
  isConfigured(): boolean;
  startConsent(userId: string, returnUrl: string): Promise<ConsentStart>;
  completeConsent(params: URLSearchParams): Promise<{ credentials: string; consentExpiresAt: Date | null }>;
  listAccounts(credentials: string): Promise<ProviderAccount[]>;
  fetchTransactions(credentials: string, cursor: string | null, since: ISODate): Promise<SyncPage>;
  revoke(credentials: string): Promise<void>;
}

/**
 * Registry. No live provider ships with Ledger: connecting to NZ banks requires a
 * commercial agreement with an open-banking provider and app registration. Until one
 * is added here, the UI shows bank sync as unavailable and offers CSV import.
 */
const providers: BankingProvider[] = [];

export function registerProvider(p: BankingProvider) {
  if (!providers.some((x) => x.id === p.id)) providers.push(p);
}

export function availableProviders(): BankingProvider[] {
  return providers.filter((p) => p.isConfigured());
}

export function getProvider(id: string): BankingProvider | undefined {
  return providers.find((p) => p.id === id);
}
