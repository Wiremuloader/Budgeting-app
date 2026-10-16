import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Database, Queryable, Tx } from "../db";
import { categories, financialAccounts, recurringRules, recurringSuggestionDismissals, transactions } from "../db/schema";
import { audit, diff, invalid, notFound, ownedAccount, ownedCategory } from "./common";
import {
  isWithinWindow,
  matchWindowDays,
  nextOccurrence,
  occurrencesBetween,
  previousOccurrence,
  describeRule,
  type Frequency,
  type IntervalUnit,
  type RecurrenceRule,
} from "@/domain/recurrence";
import { addDays, diffDays, isValidDate, type ISODate } from "@/domain/dates";
import { mulDiv, assertCents } from "@/domain/money";
import { normalizeMerchant } from "@/domain/merchant";
import { annualise, detectRecurring, possibleDuplicateSubscriptions, type DetectedPattern } from "@/domain/subscriptions";
import type { ScheduledFlow } from "@/domain/forecast";

export type RuleRow = typeof recurringRules.$inferSelect;
export type RuleKind = RuleRow["kind"];

export function toRecurrence(r: Pick<RuleRow, "frequency" | "interval" | "unit" | "anchorDate" | "endDate">): RecurrenceRule {
  return {
    frequency: r.frequency as Frequency,
    interval: r.interval ?? undefined,
    unit: (r.unit ?? undefined) as IntervalUnit | undefined,
    anchorDate: r.anchorDate,
    endDate: r.endDate,
  };
}

function tolerance(rule: RuleRow): number {
  return mulDiv(Math.abs(rule.amount), rule.amountVaries ? 35 : 10, 100);
}

type MatchableTxn = Pick<
  typeof transactions.$inferSelect,
  "id" | "accountId" | "amount" | "date" | "merchantKey" | "kind" | "recurringRuleId" | "transferGroupId"
>;

async function counterpartAccount(tx: Queryable, userId: string, t: MatchableTxn): Promise<string | null> {
  if (!t.transferGroupId) return null;
  const [o] = await tx
    .select({ accountId: transactions.accountId })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.transferGroupId, t.transferGroupId), sql`${transactions.id} <> ${t.id}`));
  return o?.accountId ?? null;
}

function merchantMatches(rule: RuleRow, t: MatchableTxn): boolean {
  if (!rule.merchantKey) return false;
  return t.merchantKey === rule.merchantKey || t.merchantKey.startsWith(rule.merchantKey) || rule.merchantKey.startsWith(t.merchantKey);
}

/**
 * Link a new transaction to the recurring rule occurrence it satisfies, if any.
 * A bill only becomes "paid" through a matching transaction, never by its date passing.
 */
export async function autoMatchTransaction(tx: Tx, userId: string, t: MatchableTxn): Promise<string | null> {
  if (t.recurringRuleId || t.kind === "adjustment") return null;
  const rules = await tx
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.userId, userId), eq(recurringRules.accountId, t.accountId), eq(recurringRules.status, "active"), eq(recurringRules.autoMatch, true)));
  if (!rules.length) return null;
  const counterpart = t.kind === "transfer" ? await counterpartAccount(tx, userId, t) : null;
  for (const rule of rules) {
    if (Math.sign(rule.amount) !== Math.sign(t.amount)) continue;
    if (Math.abs(Math.abs(rule.amount) - Math.abs(t.amount)) > tolerance(rule)) continue;
    const isTransferRule = rule.kind === "transfer" || rule.kind === "debt_payment";
    if (isTransferRule ? counterpart !== rule.toAccountId : !merchantMatches(rule, t)) continue;
    const window = matchWindowDays(toRecurrence(rule));
    const candidates = occurrencesBetween(toRecurrence(rule), addDays(t.date, -window), addDays(t.date, window));
    if (!candidates.length) continue;
    const taken = await tx
      .select({ occ: transactions.recurringOccurrence })
      .from(transactions)
      .where(and(eq(transactions.recurringRuleId, rule.id), inArray(transactions.recurringOccurrence, candidates)));
    const free = candidates
      .filter((c) => !taken.some((x) => x.occ === c))
      .sort((a, b) => Math.abs(diffDays(a, t.date)) - Math.abs(diffDays(b, t.date)));
    if (!free.length) continue;
    await tx.update(transactions).set({ recurringRuleId: rule.id, recurringOccurrence: free[0] }).where(eq(transactions.id, t.id));
    return rule.id;
  }
  return null;
}

/** Re-run matching for recent unmatched transactions (after a rule is created or edited). */
export async function rematchRule(tx: Tx, userId: string, ruleId: string, since: ISODate): Promise<number> {
  const [rule] = await tx.select().from(recurringRules).where(and(eq(recurringRules.id, ruleId), eq(recurringRules.userId, userId)));
  if (!rule) return 0;
  const candidates = await tx
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, rule.accountId),
        isNull(transactions.recurringRuleId),
        gte(transactions.date, since),
      ),
    )
    .orderBy(asc(transactions.date));
  let matched = 0;
  for (const t of candidates) if ((await autoMatchTransaction(tx, userId, t)) === rule.id) matched++;
  return matched;
}

/* -------------------------------------------------------------- CRUD */

export interface RuleInput {
  name: string;
  kind: RuleKind;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  /** Positive magnitude; the sign is derived from `kind`. */
  amount: number;
  amountVaries?: boolean;
  frequency: Frequency;
  interval?: number | null;
  unit?: IntervalUnit | null;
  anchorDate: ISODate;
  endDate?: ISODate | null;
  merchantKey?: string | null;
  autoMatch?: boolean;
  notes?: string | null;
  source?: "manual" | "detected" | "onboarding";
}

function signedAmount(kind: RuleKind, magnitude: number): number {
  assertCents(magnitude);
  if (magnitude <= 0) throw invalid("Amount must be greater than zero");
  return kind === "income" ? magnitude : -magnitude;
}

async function validateRule(tx: Queryable, userId: string, input: RuleInput) {
  if (!input.name.trim()) throw invalid("Name is required");
  if (!isValidDate(input.anchorDate)) throw invalid("Invalid start date");
  if (input.endDate && (!isValidDate(input.endDate) || input.endDate < input.anchorDate)) throw invalid("End date must be after the start date");
  if (input.frequency === "custom" && (!input.interval || input.interval < 1 || !input.unit)) throw invalid("Custom schedules need an interval and unit");
  await ownedAccount(tx, userId, input.accountId);
  if (input.kind === "transfer" || input.kind === "debt_payment") {
    if (!input.toAccountId) throw invalid("Choose the destination account");
    if (input.toAccountId === input.accountId) throw invalid("Source and destination must differ");
    await ownedAccount(tx, userId, input.toAccountId);
  }
  if (input.categoryId) await ownedCategory(tx, userId, input.categoryId);
}

export async function createRule(db: Database, userId: string, input: RuleInput, today: ISODate): Promise<RuleRow> {
  return db.transaction(async (tx) => {
    await validateRule(tx, userId, input);
    const [rule] = await tx
      .insert(recurringRules)
      .values({
        userId,
        name: input.name.trim(),
        kind: input.kind,
        accountId: input.accountId,
        toAccountId: input.kind === "transfer" || input.kind === "debt_payment" ? input.toAccountId! : null,
        categoryId: input.categoryId ?? null,
        amount: signedAmount(input.kind, input.amount),
        amountVaries: input.amountVaries ?? false,
        frequency: input.frequency,
        interval: input.frequency === "custom" ? input.interval! : null,
        unit: input.frequency === "custom" ? input.unit! : null,
        anchorDate: input.anchorDate,
        endDate: input.endDate ?? null,
        merchantKey: input.merchantKey ?? normalizeMerchant(input.name).key,
        autoMatch: input.autoMatch ?? true,
        notes: input.notes?.trim() || null,
        source: input.source ?? "manual",
      })
      .returning();
    await rematchRule(tx, userId, rule.id, addDays(today, -120));
    await audit(tx, userId, "recurring_rule", rule.id, "create", { name: rule.name, amount: rule.amount, frequency: rule.frequency });
    return rule;
  });
}

export async function updateRule(db: Database, userId: string, ruleId: string, input: RuleInput, today: ISODate): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(recurringRules).where(and(eq(recurringRules.id, ruleId), eq(recurringRules.userId, userId)));
    if (!before) throw notFound("Recurring payment");
    await validateRule(tx, userId, input);
    const values = {
      name: input.name.trim(),
      kind: input.kind,
      accountId: input.accountId,
      toAccountId: input.kind === "transfer" || input.kind === "debt_payment" ? input.toAccountId! : null,
      categoryId: input.categoryId ?? null,
      amount: signedAmount(input.kind, input.amount),
      amountVaries: input.amountVaries ?? false,
      frequency: input.frequency,
      interval: input.frequency === "custom" ? input.interval! : null,
      unit: input.frequency === "custom" ? input.unit! : null,
      anchorDate: input.anchorDate,
      endDate: input.endDate ?? null,
      merchantKey: input.merchantKey ?? before.merchantKey,
      autoMatch: input.autoMatch ?? before.autoMatch,
      notes: input.notes?.trim() || null,
    };
    await tx.update(recurringRules).set(values).where(eq(recurringRules.id, ruleId));
    await rematchRule(tx, userId, ruleId, addDays(today, -120));
    await audit(tx, userId, "recurring_rule", ruleId, "update", diff(before, values));
  });
}

export async function setRuleStatus(db: Database, userId: string, ruleId: string, status: "active" | "paused" | "ended") {
  const res = await db
    .update(recurringRules)
    .set({ status })
    .where(and(eq(recurringRules.id, ruleId), eq(recurringRules.userId, userId)))
    .returning({ id: recurringRules.id });
  if (!res.length) throw notFound("Recurring payment");
  await audit(db, userId, "recurring_rule", ruleId, `status_${status}`);
}

export async function deleteRule(db: Database, userId: string, ruleId: string) {
  await db.transaction(async (tx) => {
    const res = await tx.delete(recurringRules).where(and(eq(recurringRules.id, ruleId), eq(recurringRules.userId, userId))).returning();
    if (!res.length) throw notFound("Recurring payment");
    await audit(tx, userId, "recurring_rule", ruleId, "delete", { name: res[0].name });
  });
}

/** Manually link (or unlink with ruleId = null) a transaction to an occurrence. */
export async function linkTransaction(db: Database, userId: string, transactionId: string, ruleId: string | null, occurrence?: ISODate) {
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(transactions).where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));
    if (!t) throw notFound("Transaction");
    if (!ruleId) {
      await tx.update(transactions).set({ recurringRuleId: null, recurringOccurrence: null }).where(eq(transactions.id, t.id));
      return;
    }
    const [rule] = await tx.select().from(recurringRules).where(and(eq(recurringRules.id, ruleId), eq(recurringRules.userId, userId)));
    if (!rule) throw notFound("Recurring payment");
    const occ =
      occurrence ??
      occurrencesBetween(toRecurrence(rule), addDays(t.date, -45), addDays(t.date, 45)).sort(
        (a, b) => Math.abs(diffDays(a, t.date)) - Math.abs(diffDays(b, t.date)),
      )[0];
    if (!occ) throw invalid("No scheduled occurrence near this date");
    await tx.update(transactions).set({ recurringRuleId: rule.id, recurringOccurrence: occ }).where(eq(transactions.id, t.id));
    await audit(tx, userId, "transaction", t.id, "link_recurring", { ruleId, occurrence: occ });
  });
}

/* -------------------------------------------------------------- reads */

export type OccurrenceStatus = "paid" | "upcoming" | "due" | "late" | "missed";

export interface Occurrence {
  ruleId: string;
  name: string;
  kind: RuleKind;
  date: ISODate;
  amount: number;
  status: OccurrenceStatus;
  transactionId: string | null;
  actualAmount: number | null;
  accountId: string;
  categoryId: string | null;
}

export interface RuleSummary extends RuleRow {
  accountName: string;
  toAccountName: string | null;
  categoryName: string | null;
  schedule: string;
  next: ISODate | null;
  annualCost: number;
  monthlyCost: number;
  lastMatched: { date: ISODate; amount: number } | null;
  /** Last actual amount differs from the expected amount. */
  amountChanged: boolean;
}

export async function listRules(db: Queryable, userId: string, today: ISODate): Promise<RuleSummary[]> {
  const rules = await db
    .select({ r: recurringRules, accountName: financialAccounts.name, categoryName: categories.name })
    .from(recurringRules)
    .innerJoin(financialAccounts, eq(financialAccounts.id, recurringRules.accountId))
    .leftJoin(categories, eq(categories.id, recurringRules.categoryId))
    .where(eq(recurringRules.userId, userId))
    .orderBy(asc(recurringRules.name));
  const accountNames = new Map(
    (await db.select({ id: financialAccounts.id, name: financialAccounts.name }).from(financialAccounts).where(eq(financialAccounts.userId, userId))).map((a) => [a.id, a.name]),
  );
  const lastMatches = await db
    .selectDistinctOn([transactions.recurringRuleId], { ruleId: transactions.recurringRuleId, date: transactions.date, amount: transactions.amount })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNotNull(transactions.recurringRuleId)))
    .orderBy(transactions.recurringRuleId, desc(transactions.date));
  return rules.map(({ r, accountName, categoryName }) => {
    const rec = toRecurrence(r);
    const last = lastMatches.find((m) => m.ruleId === r.id);
    const annual = annualise(Math.abs(r.amount), r.frequency as Frequency, r.frequency === "custom" ? approximateDays(r) : undefined);
    return {
      ...r,
      accountName,
      toAccountName: r.toAccountId ? (accountNames.get(r.toAccountId) ?? null) : null,
      categoryName,
      schedule: describeRule(rec),
      next: r.status === "active" ? nextOccurrence(rec, today) : null,
      annualCost: annual,
      monthlyCost: mulDiv(annual, 1, 12),
      lastMatched: last ? { date: last.date, amount: last.amount } : null,
      amountChanged: Boolean(last && !r.amountVaries && last.amount !== r.amount),
    };
  });
}

function approximateDays(r: RuleRow): number {
  const n = r.interval ?? 1;
  return r.unit === "day" ? n : r.unit === "week" ? 7 * n : r.unit === "year" ? 365 * n : Math.round(30.44 * n);
}

/** Occurrences in [from, to] with their payment status. */
export async function occurrences(db: Queryable, userId: string, from: ISODate, to: ISODate, today: ISODate): Promise<Occurrence[]> {
  const rules = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.userId, userId), eq(recurringRules.status, "active")));
  if (!rules.length) return [];
  const matched = await db
    .select({ id: transactions.id, ruleId: transactions.recurringRuleId, occ: transactions.recurringOccurrence, amount: transactions.amount })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.recurringRuleId, rules.map((r) => r.id)),
        gte(transactions.recurringOccurrence, from),
        lte(transactions.recurringOccurrence, to),
      ),
    );
  const out: Occurrence[] = [];
  for (const r of rules) {
    const window = matchWindowDays(toRecurrence(r));
    for (const d of occurrencesBetween(toRecurrence(r), from, to)) {
      const m = matched.find((x) => x.ruleId === r.id && x.occ === d);
      let status: OccurrenceStatus;
      if (m) status = "paid";
      else if (d > today) status = "upcoming";
      else if (d === today) status = "due";
      else if (isWithinWindow(d, today, window)) status = "late";
      else status = "missed";
      out.push({
        ruleId: r.id,
        name: r.name,
        kind: r.kind,
        date: d,
        amount: r.amount,
        status,
        transactionId: m?.id ?? null,
        actualAmount: m?.amount ?? null,
        accountId: r.accountId,
        categoryId: r.categoryId,
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
}

export async function nextPayday(db: Queryable, userId: string, today: ISODate): Promise<{ date: ISODate; name: string; amount: number } | null> {
  const rules = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.userId, userId), eq(recurringRules.status, "active"), eq(recurringRules.kind, "income")));
  let best: { date: ISODate; name: string; amount: number } | null = null;
  for (const r of rules) {
    const d = nextOccurrence(toRecurrence(r), addDays(today, 1)) ;
    const todayOcc = occurrencesBetween(toRecurrence(r), today, today)[0];
    // If pay is due today and hasn't arrived, today still counts as payday.
    const candidate = todayOcc ?? d;
    if (candidate && (!best || candidate < best.date)) best = { date: candidate, name: r.name, amount: r.amount };
  }
  return best;
}

/**
 * Scheduled cash flows for the forecast, seen from a set of accounts.
 * Transfers inside the set are dropped so they can't inflate or deflate the total.
 */
export async function forecastFlows(db: Queryable, userId: string, accountIds: Set<string>, from: ISODate, to: ISODate): Promise<ScheduledFlow[]> {
  const rules = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.userId, userId), eq(recurringRules.status, "active")));
  const settled = await db
    .select({ ruleId: transactions.recurringRuleId, occ: transactions.recurringOccurrence })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNotNull(transactions.recurringRuleId), gte(transactions.recurringOccurrence, from), lte(transactions.recurringOccurrence, to)));
  const flows: ScheduledFlow[] = [];
  for (const r of rules) {
    const fromIn = accountIds.has(r.accountId);
    const toIn = r.toAccountId ? accountIds.has(r.toAccountId) : false;
    let amount: number;
    if (fromIn && toIn) continue;
    else if (fromIn) amount = r.amount;
    else if (toIn) amount = -r.amount;
    else continue;
    flows.push({
      amount,
      label: r.name,
      source: "recurring",
      rule: toRecurrence(r),
      settledDates: settled.filter((s) => s.ruleId === r.id).map((s) => s.occ!) ,
    });
  }
  // One-off future-dated transactions the user has entered.
  const future = await db
    .select({ date: transactions.date, amount: transactions.amount, merchant: transactions.merchant, accountId: transactions.accountId, kind: transactions.kind, group: transactions.transferGroupId })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), gte(transactions.date, from), lte(transactions.date, to), isNull(transactions.recurringRuleId)));
  const groupsInside = new Map<string, number>();
  for (const f of future) if (f.group && accountIds.has(f.accountId)) groupsInside.set(f.group, (groupsInside.get(f.group) ?? 0) + 1);
  for (const f of future) {
    if (!accountIds.has(f.accountId)) continue;
    if (f.group && groupsInside.get(f.group) === 2) continue;
    flows.push({ amount: f.amount, label: f.merchant, source: "planned", date: f.date });
  }
  return flows;
}

/* ------------------------------------------------------- suggestions */

export interface Suggestion extends DetectedPattern {
  categoryName: string | null;
  accountName: string;
  duplicateOf: string | null;
}

export async function detectSuggestions(db: Queryable, userId: string, today: ISODate): Promise<Suggestion[]> {
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      merchantKey: transactions.merchantKey,
      merchantName: transactions.merchant,
      categoryId: transactions.categoryId,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.kind, "standard"), gte(transactions.date, addDays(today, -400)), isNull(transactions.recurringRuleId)));
  const patterns = detectRecurring(rows, today);
  const [rules, dismissed, cats, accts] = await Promise.all([
    db.select({ merchantKey: recurringRules.merchantKey, name: recurringRules.name }).from(recurringRules).where(eq(recurringRules.userId, userId)),
    db.select().from(recurringSuggestionDismissals).where(eq(recurringSuggestionDismissals.userId, userId)),
    db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.userId, userId)),
    db.select({ id: financialAccounts.id, name: financialAccounts.name }).from(financialAccounts).where(eq(financialAccounts.userId, userId)),
  ]);
  const known = new Set(rules.map((r) => r.merchantKey).filter(Boolean));
  const dismissedKeys = new Set(dismissed.map((d) => d.merchantKey));
  const subs = rules.filter((r) => r.merchantKey).map((r) => ({ id: r.name, merchantKey: r.merchantKey! }));
  return patterns
    .filter((p) => !known.has(p.merchantKey) && !dismissedKeys.has(p.merchantKey))
    .map((p) => {
      const dup = possibleDuplicateSubscriptions([...subs, { id: "__new", merchantKey: p.merchantKey }]).find((pair) => pair.includes("__new"));
      return {
        ...p,
        categoryName: cats.find((c) => c.id === p.categoryId)?.name ?? null,
        accountName: accts.find((a) => a.id === p.accountId)?.name ?? "",
        duplicateOf: dup ? dup.find((x) => x !== "__new")! : null,
      };
    });
}

export async function confirmSuggestion(
  db: Database,
  userId: string,
  merchantKey: string,
  kind: "bill" | "subscription" | "income",
  today: ISODate,
): Promise<RuleRow> {
  const suggestion = (await detectSuggestions(db, userId, today)).find((s) => s.merchantKey === merchantKey);
  if (!suggestion) throw notFound("Suggestion");
  const rule = await createRule(
    db,
    userId,
    {
      name: suggestion.merchantName,
      kind,
      accountId: suggestion.accountId,
      categoryId: suggestion.categoryId,
      amount: Math.abs(suggestion.amount),
      amountVaries: suggestion.priceChange !== null && kind !== "subscription",
      frequency: suggestion.frequency,
      anchorDate: suggestion.lastDate,
      merchantKey: suggestion.merchantKey,
      source: "detected",
    },
    today,
  );
  // Link the history that produced the suggestion.
  await db.transaction(async (tx) => {
    for (const id of suggestion.transactionIds) {
      const [t] = await tx.select().from(transactions).where(and(eq(transactions.id, id), eq(transactions.userId, userId)));
      if (!t || t.recurringRuleId) continue;
      const occ = previousOccurrence(toRecurrence(rule), t.date) ?? t.date;
      await tx.update(transactions).set({ recurringRuleId: rule.id, recurringOccurrence: occ }).where(eq(transactions.id, id));
    }
  });
  return rule;
}

export async function dismissSuggestion(db: Database, userId: string, merchantKey: string) {
  await db.insert(recurringSuggestionDismissals).values({ userId, merchantKey }).onConflictDoNothing();
}

/** Total recurring commitments per month (outflows positive), for the "fixed costs" view. */
export function monthlyCommitments(rules: RuleSummary[]) {
  const active = rules.filter((r) => r.status === "active");
  const outflow = active.filter((r) => r.amount < 0 && r.kind !== "transfer").reduce((a, r) => a + r.monthlyCost, 0);
  const income = active.filter((r) => r.kind === "income").reduce((a, r) => a + r.monthlyCost, 0);
  const transfers = active.filter((r) => r.kind === "transfer").reduce((a, r) => a + r.monthlyCost, 0);
  return { outflow, income, transfers, disposable: income - outflow - transfers };
}
