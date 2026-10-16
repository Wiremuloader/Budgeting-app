import { add, assertCents, ratioBps, sum, type Cents } from "./money";
import type { ISODate } from "./dates";

/**
 * Ledger classification rules. See docs/FINANCIAL_RULES.md.
 *
 * Sign convention: a transaction amount is signed from the ACCOUNT's point of view.
 *   + money flows into the account (salary into checking, refund onto a card,
 *     a payment that reduces a credit-card balance)
 *   − money flows out of the account (purchase, bill, cash withdrawal)
 *
 * Liability accounts (credit cards, loans) therefore carry negative balances:
 * a card with −$420.00 means $420.00 is owed.
 */

export type TransactionKind = "standard" | "transfer" | "adjustment";
export type TransactionStatus = "pending" | "cleared" | "reconciled";
export type CategoryGroup = "income" | "expense";

export type AccountType =
  | "checking"
  | "savings"
  | "cash"
  | "credit_card"
  | "loan"
  | "investment"
  | "other_asset"
  | "other_liability";

export const LIABILITY_TYPES: readonly AccountType[] = ["credit_card", "loan", "other_liability"];
/** Accounts whose money funds the budget and the "safe to spend" figure by default. */
export const CASH_TYPES: readonly AccountType[] = ["checking", "savings", "cash"];

export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type);
}

export function isCash(type: AccountType): boolean {
  return CASH_TYPES.includes(type);
}

/**
 * One categorised line. An unsplit transaction contributes one line; a split
 * transaction contributes one line per split (and none for the parent).
 */
export interface LedgerLine {
  transactionId: string;
  date: ISODate;
  accountId: string;
  amount: Cents;
  kind: TransactionKind;
  status: TransactionStatus;
  categoryId: string | null;
  categoryGroup: CategoryGroup | null;
}

export interface PeriodSummary {
  /** Inflows categorised as income, net of negative income corrections. */
  income: Cents;
  /** Outflows in expense categories minus refunds, plus uncategorised outflows. Positive = money spent. */
  spending: Cents;
  /** Refunds included (as a reduction) in `spending`. Positive. */
  refunds: Cents;
  /** Uncategorised outflows (positive), included in spending. */
  uncategorisedOutflows: Cents;
  /** Uncategorised inflows (positive). NOT counted as income — they need review. */
  uncategorisedInflows: Cents;
  /** income − spending. */
  net: Cents;
  /** Spending that is still pending (positive), included in `spending`. */
  pendingSpending: Cents;
  /** Savings rate in basis points, null if there was no income. */
  savingsRateBps: number | null;
}

/**
 * Summarise income and spending. Transfers and balance adjustments are excluded
 * entirely: moving money between your own accounts, paying a credit card, or
 * correcting a balance is neither income nor spending.
 */
export function summarize(lines: Iterable<LedgerLine>): PeriodSummary {
  let income = 0;
  let expenseNet = 0; // negative for net spending
  let refunds = 0;
  let uncatOut = 0;
  let uncatIn = 0;
  let pending = 0;
  for (const l of lines) {
    assertCents(l.amount);
    if (l.kind !== "standard") continue;
    if (l.categoryGroup === "income") {
      income = add(income, l.amount);
    } else if (l.categoryGroup === "expense") {
      expenseNet = add(expenseNet, l.amount);
      if (l.amount > 0) refunds = add(refunds, l.amount);
      if (l.status === "pending" && l.amount < 0) pending = add(pending, -l.amount);
    } else if (l.amount < 0) {
      uncatOut = add(uncatOut, -l.amount);
      if (l.status === "pending") pending = add(pending, -l.amount);
    } else {
      uncatIn = add(uncatIn, l.amount);
    }
  }
  const spending = add(-expenseNet, uncatOut);
  const net = add(income, -spending);
  const savingsRateBps =
    income > 0 ? ratioBps(net, income) : null;
  return {
    income,
    spending: spending === 0 ? 0 : spending,
    refunds,
    uncategorisedOutflows: uncatOut,
    uncategorisedInflows: uncatIn,
    net,
    pendingSpending: pending,
    savingsRateBps,
  };
}

/** Net spending per expense category (positive = spent). Refunds reduce it and can make it negative. */
export function spendingByCategory(lines: Iterable<LedgerLine>): Map<string | null, Cents> {
  const out = new Map<string | null, Cents>();
  for (const l of lines) {
    if (l.kind !== "standard") continue;
    if (l.categoryGroup === "income") continue;
    if (l.categoryGroup === null && l.amount > 0) continue; // unreviewed inflow
    out.set(l.categoryId, add(out.get(l.categoryId) ?? 0, -l.amount));
  }
  return out;
}

export function incomeByCategory(lines: Iterable<LedgerLine>): Map<string, Cents> {
  const out = new Map<string, Cents>();
  for (const l of lines) {
    if (l.kind !== "standard" || l.categoryGroup !== "income" || !l.categoryId) continue;
    out.set(l.categoryId, add(out.get(l.categoryId) ?? 0, l.amount));
  }
  return out;
}

/* ---------------------------------------------------------------- balances */

export interface BalanceInput {
  amount: Cents;
  status: TransactionStatus;
}

export interface AccountBalance {
  /** All posted activity including pending. What the account will show once pending settles. */
  current: Cents;
  /** Cleared + reconciled only. */
  cleared: Cents;
  pending: Cents;
}

export function accountBalance(txns: Iterable<BalanceInput>): AccountBalance {
  let cleared = 0;
  let pending = 0;
  for (const t of txns) {
    if (t.status === "pending") pending = add(pending, t.amount);
    else cleared = add(cleared, t.amount);
  }
  return { current: add(cleared, pending), cleared, pending };
}

export interface AccountForTotals {
  id: string;
  type: AccountType;
  currency: string;
  balance: Cents;
  includeInNetWorth: boolean;
  spendable: boolean;
  archived?: boolean;
}

export interface Totals {
  currency: string;
  /** Sum of cash-type account balances (checking, savings, cash). */
  cash: Cents;
  /** Sum of balances in accounts marked spendable. */
  spendable: Cents;
  assets: Cents;
  /** Positive number: total owed. */
  liabilities: Cents;
  netWorth: Cents;
  /** Accounts left out because they use a different currency. */
  excludedAccountIds: string[];
}

/**
 * Aggregate account balances in one currency. Accounts in other currencies are
 * excluded (and reported) rather than summed without a conversion rate.
 */
export function totals(accounts: AccountForTotals[], currency: string): Totals {
  let cash = 0;
  let spendable = 0;
  let assets = 0;
  let liabilities = 0;
  const excluded: string[] = [];
  for (const a of accounts) {
    if (a.archived) continue;
    if (a.currency !== currency) {
      excluded.push(a.id);
      continue;
    }
    if (isCash(a.type)) cash = add(cash, a.balance);
    if (a.spendable) spendable = add(spendable, a.balance);
    if (!a.includeInNetWorth) continue;
    if (isLiability(a.type)) {
      // A liability with a positive balance (overpaid card) is an asset to you.
      if (a.balance < 0) liabilities = add(liabilities, -a.balance);
      else assets = add(assets, a.balance);
    } else if (a.balance >= 0) {
      assets = add(assets, a.balance);
    } else {
      // An overdrawn asset account is money owed.
      liabilities = add(liabilities, -a.balance);
    }
  }
  return {
    currency,
    cash,
    spendable,
    assets,
    liabilities,
    netWorth: add(assets, -liabilities),
    excludedAccountIds: excluded,
  };
}

/* ------------------------------------------------------------------ splits */

export interface SplitInput {
  categoryId: string;
  amount: Cents;
}

export class SplitError extends Error {}

/** Splits must have ≥2 parts, share the parent's sign, and sum exactly to the parent. */
export function validateSplits(parentAmount: Cents, splits: SplitInput[]): void {
  if (splits.length < 2) throw new SplitError("A split needs at least two parts");
  for (const s of splits) {
    assertCents(s.amount, "split amount");
    if (s.amount === 0) throw new SplitError("Split parts cannot be zero");
  }
  const total = sum(splits.map((s) => s.amount));
  if (total !== parentAmount) {
    throw new SplitError(
      `Split parts total ${total} but the transaction is ${parentAmount}; difference ${parentAmount - total}`,
    );
  }
}

/* --------------------------------------------------------------- transfers */

export interface TransferLegs {
  from: { accountId: string; amount: Cents };
  to: { accountId: string; amount: Cents };
}

/** A transfer of `amount` (positive) creates two legs that net to zero. */
export function transferLegs(fromAccountId: string, toAccountId: string, amount: Cents): TransferLegs {
  assertCents(amount);
  if (amount <= 0) throw new RangeError("Transfer amount must be positive");
  if (fromAccountId === toAccountId) throw new RangeError("Cannot transfer to the same account");
  return { from: { accountId: fromAccountId, amount: -amount }, to: { accountId: toAccountId, amount } };
}

/* ------------------------------------------------------------- reconciling */

export interface ReconcileResult {
  ledgerCleared: Cents;
  statementBalance: Cents;
  difference: Cents;
  balanced: boolean;
}

export function reconcile(ledgerCleared: Cents, statementBalance: Cents): ReconcileResult {
  const difference = add(statementBalance, -ledgerCleared);
  return { ledgerCleared, statementBalance, difference, balanced: difference === 0 };
}
