"use server";

import { z } from "zod";
import { run, zCents, zDate, zId, zMonth } from "./run";
import * as accounts from "../services/accounts";
import * as txns from "../services/transactions";
import * as cats from "../services/categories";
import * as budget from "../services/budget";
import * as recurring from "../services/recurring";
import * as goals from "../services/goals";
import * as debts from "../services/debts";
import { dismissInsight } from "../services/insights";
import { ACCOUNT_TYPES } from "../db/schema";

/* -------------------------------------------------------------- accounts */

const accountCreate = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().regex(/^[A-Z]{3}$/),
  institution: z.string().max(60).nullish(),
  mask: z.string().regex(/^\d{2,4}$/, "Last 2–4 digits only").nullish().or(z.literal("")),
  openingBalance: zCents,
  openingDate: zDate,
  spendable: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
});
export async function createAccountAction(input: z.infer<typeof accountCreate>) {
  return run(accountCreate, input, async ({ db, user }, d) => (await accounts.createAccount(db, user.id, { ...d, mask: d.mask || null })).id);
}

const accountUpdate = z.object({
  id: zId,
  name: z.string().trim().min(1).max(60).optional(),
  institution: z.string().max(60).nullish(),
  mask: z.string().regex(/^\d{2,4}$/).nullish().or(z.literal("")),
  spendable: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
  onBudget: z.boolean().optional(),
});
export async function updateAccountAction(input: z.infer<typeof accountUpdate>) {
  return run(accountUpdate, input, ({ db, user }, { id, ...patch }) => accounts.updateAccount(db, user.id, id, { ...patch, mask: patch.mask === "" ? null : patch.mask }));
}

export async function archiveAccountAction(input: { id: string; archived: boolean }) {
  return run(z.object({ id: zId, archived: z.boolean() }), input, ({ db, user }, d) => accounts.setAccountArchived(db, user.id, d.id, d.archived));
}

export async function removeSampleDataAction() {
  return run(z.undefined(), undefined, ({ db, user }) => accounts.removeSampleData(db, user.id));
}

export async function deleteAccountAction(input: { id: string }) {
  return run(z.object({ id: zId }), input, ({ db, user }, d) => accounts.deleteAccount(db, user.id, d.id));
}

const adjust = z.object({ id: zId, newBalance: zCents, date: zDate, reason: z.string().trim().min(3, "Please explain the adjustment").max(200) });
export async function adjustBalanceAction(input: z.infer<typeof adjust>) {
  return run(adjust, input, ({ db, user }, d) => accounts.adjustBalance(db, user.id, d.id, d));
}

const reconcileSchema = z.object({ id: zId, statementBalance: zCents, statementDate: zDate });
export async function reconcileAction(input: z.infer<typeof reconcileSchema>) {
  return run(reconcileSchema, input, ({ db, user }, d) => accounts.reconcileAccount(db, user.id, d.id, d));
}

/* ---------------------------------------------------------- transactions */

const split = z.object({ categoryId: zId, amount: zCents, notes: z.string().max(200).nullish() });
const txnBase = {
  accountId: zId,
  date: zDate,
  time: z.string().regex(/^[0-2]\d:[0-5]\d$/).nullish().or(z.literal("")),
  amount: zCents,
  merchant: z.string().trim().min(1, "Payee is required").max(200),
  description: z.string().max(500).nullish(),
  notes: z.string().max(1000).nullish(),
  categoryId: zId.nullish(),
  status: z.enum(["pending", "cleared"]).optional(),
  tags: z.array(z.string().max(32)).max(12).optional(),
  splits: z.array(split).max(20).nullish(),
};
const txnCreate = z.object(txnBase);
export async function createTransactionAction(input: z.infer<typeof txnCreate>) {
  return run(txnCreate, input, async ({ db, user }, d) => (await txns.createTransaction(db, user.id, { ...d, time: d.time || null, categoryId: d.categoryId ?? null })).id);
}

const txnUpdate = z.object({
  id: zId,
  ...Object.fromEntries(Object.entries(txnBase).map(([k, v]) => [k, (v as z.ZodType).optional()])),
  reviewed: z.boolean().optional(),
  expectedUpdatedAt: z.string().optional(),
}) as z.ZodType<{ id: string; expectedUpdatedAt?: string; reviewed?: boolean } & Partial<z.infer<typeof txnCreate>>>;
export async function updateTransactionAction(input: z.infer<typeof txnUpdate>) {
  return run(txnUpdate, input, ({ db, user }, { id, ...patch }) =>
    txns.updateTransaction(db, user.id, id, { ...patch, time: patch.time === "" ? null : patch.time, status: patch.status }),
  );
}

export async function deleteTransactionAction(input: { id: string }) {
  return run(z.object({ id: zId }), input, ({ db, user }, d) => txns.deleteTransaction(db, user.id, d.id));
}

const transfer = z.object({
  fromAccountId: zId,
  toAccountId: zId,
  amount: zCents.refine((n) => n > 0, "Amount must be greater than zero"),
  date: zDate,
  notes: z.string().max(1000).nullish(),
  categoryId: zId.nullish(),
  status: z.enum(["pending", "cleared"]).optional(),
});
export async function createTransferAction(input: z.infer<typeof transfer>) {
  return run(transfer, input, async ({ db, user }, d) => (await txns.createTransfer(db, user.id, d)).groupId);
}

const bulk = z.object({
  ids: z.array(zId).min(1).max(500),
  categoryId: zId.nullish(),
  reviewed: z.boolean().optional(),
  status: z.enum(["pending", "cleared"]).optional(),
  addTag: z.string().max(32).optional(),
});
export async function bulkUpdateAction(input: z.infer<typeof bulk>) {
  return run(bulk, input, ({ db, user }, { ids, ...patch }) => txns.bulkUpdate(db, user.id, ids, patch));
}

export async function bulkDeleteAction(input: { ids: string[] }) {
  return run(z.object({ ids: z.array(zId).min(1).max(500) }), input, ({ db, user }, d) => txns.bulkDelete(db, user.id, d.ids));
}

export async function linkTransferAction(input: { a: string; b: string }) {
  return run(z.object({ a: zId, b: zId }), input, ({ db, user }, d) => txns.linkAsTransfer(db, user.id, d.a, d.b));
}

export async function unlinkTransferAction(input: { id: string }) {
  return run(z.object({ id: zId }), input, ({ db, user }, d) => txns.unlinkTransfer(db, user.id, d.id));
}

export async function transactionHistoryAction(input: { id: string }) {
  return run(
    z.object({ id: zId }),
    input,
    async ({ db, user }, d) => (await txns.transactionHistory(db, user.id, d.id)).map((h) => ({ id: h.id, action: h.action, source: h.source, changes: h.changes, createdAt: h.createdAt.toISOString() })),
    { revalidate: [] },
  );
}

export async function suggestCategoryAction(input: { merchant: string }) {
  return run(z.object({ merchant: z.string().max(200) }), input, ({ db, user }, d) => txns.suggestCategory(db, user.id, d.merchant), { revalidate: [] });
}

const rule = z.object({ pattern: z.string().trim().min(3).max(80), merchantName: z.string().max(80).nullish(), categoryId: zId.nullish() });
export async function saveMerchantRuleAction(input: z.infer<typeof rule>) {
  return run(rule, input, ({ db, user }, d) => txns.saveMerchantRule(db, user.id, d));
}

/* ------------------------------------------------------------ categories */

const catCreate = z.object({
  name: z.string().trim().min(1).max(60),
  group: z.enum(["income", "expense"]),
  parentId: zId.nullish(),
  rollover: z.boolean().optional(),
});
export async function createCategoryAction(input: z.infer<typeof catCreate>) {
  return run(catCreate, input, async ({ db, user }, d) => (await cats.createCategory(db, user.id, d)).id);
}

const catUpdate = z.object({
  id: zId,
  name: z.string().trim().min(1).max(60).optional(),
  rollover: z.boolean().optional(),
  alertThresholdBps: z.number().int().min(1000).max(10000).optional(),
  alertsEnabled: z.boolean().optional(),
  parentId: zId.nullish(),
});
export async function updateCategoryAction(input: z.infer<typeof catUpdate>) {
  return run(catUpdate, input, ({ db, user }, { id, ...patch }) => cats.updateCategory(db, user.id, id, patch));
}

export async function archiveCategoryAction(input: { id: string; archived: boolean }) {
  return run(z.object({ id: zId, archived: z.boolean() }), input, ({ db, user }, d) => cats.setCategoryArchived(db, user.id, d.id, d.archived));
}

export async function reorderCategoriesAction(input: { ids: string[] }) {
  return run(z.object({ ids: z.array(zId).max(200) }), input, ({ db, user }, d) => cats.reorderCategories(db, user.id, d.ids));
}

/* ---------------------------------------------------------------- budget */

const assign = z.object({ month: zMonth, categoryId: zId, amount: zCents.refine((n) => n >= 0, "Can't be negative") });
export async function setAssignedAction(input: z.infer<typeof assign>) {
  return run(assign, input, ({ db, user }, d) => budget.setAssigned(db, user.id, d.month, d.categoryId, d.amount));
}

const move = z.object({ month: zMonth, from: zId, to: zId, amount: zCents.refine((n) => n > 0) });
export async function moveMoneyAction(input: z.infer<typeof move>) {
  return run(move, input, ({ db, user }, d) => budget.moveMoney(db, user.id, d.month, d.from, d.to, d.amount));
}

export async function copyPreviousMonthAction(input: { month: string }) {
  return run(z.object({ month: zMonth }), input, ({ db, user }, d) => budget.copyPreviousMonth(db, user.id, d.month));
}

const applyAlloc = z.object({ month: zMonth, allocations: z.array(z.object({ categoryId: zId, amount: zCents })).min(1).max(100), source: z.enum(["user", "assistant"]).optional() });
export async function applyAllocationsAction(input: z.infer<typeof applyAlloc>) {
  return run(applyAlloc, input, ({ db, user }, d) => budget.applyAllocations(db, user.id, d.month, d.allocations, d.source ?? "user"));
}

export async function setBudgetMethodAction(input: { method: "envelope" | "flexible" }) {
  return run(z.object({ method: z.enum(["envelope", "flexible"]) }), input, ({ db, user }, d) => budget.setBudgetMethod(db, user.id, d.method));
}

/* ------------------------------------------------------------- recurring */

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["income", "bill", "subscription", "transfer", "debt_payment"]),
  accountId: zId,
  toAccountId: zId.nullish(),
  categoryId: zId.nullish(),
  amount: zCents.refine((n) => n > 0, "Amount must be greater than zero"),
  amountVaries: z.boolean().optional(),
  frequency: z.enum(["weekly", "fortnightly", "monthly", "quarterly", "yearly", "custom"]),
  interval: z.number().int().min(1).max(366).nullish(),
  unit: z.enum(["day", "week", "month", "year"]).nullish(),
  anchorDate: zDate,
  endDate: zDate.nullish().or(z.literal("")),
  notes: z.string().max(500).nullish(),
});
export async function createRuleAction(input: z.infer<typeof ruleSchema>) {
  return run(ruleSchema, input, async ({ db, user, today }, d) => (await recurring.createRule(db, user.id, { ...d, endDate: d.endDate || null }, today)).id);
}
export async function updateRuleAction(input: z.infer<typeof ruleSchema> & { id: string }) {
  return run(ruleSchema.extend({ id: zId }), input, ({ db, user, today }, { id, ...d }) => recurring.updateRule(db, user.id, id, { ...d, endDate: d.endDate || null }, today));
}
export async function setRuleStatusAction(input: { id: string; status: "active" | "paused" | "ended" }) {
  return run(z.object({ id: zId, status: z.enum(["active", "paused", "ended"]) }), input, ({ db, user }, d) => recurring.setRuleStatus(db, user.id, d.id, d.status));
}
export async function deleteRuleAction(input: { id: string }) {
  return run(z.object({ id: zId }), input, ({ db, user }, d) => recurring.deleteRule(db, user.id, d.id));
}
export async function confirmSuggestionAction(input: { merchantKey: string; kind: "bill" | "subscription" | "income" }) {
  return run(z.object({ merchantKey: z.string().min(1).max(200), kind: z.enum(["bill", "subscription", "income"]) }), input, async ({ db, user, today }, d) =>
    (await recurring.confirmSuggestion(db, user.id, d.merchantKey, d.kind, today)).id,
  );
}
export async function dismissSuggestionAction(input: { merchantKey: string }) {
  return run(z.object({ merchantKey: z.string().min(1).max(200) }), input, ({ db, user }, d) => recurring.dismissSuggestion(db, user.id, d.merchantKey));
}
export async function linkRecurringAction(input: { transactionId: string; ruleId: string | null }) {
  return run(z.object({ transactionId: zId, ruleId: zId.nullable() }), input, ({ db, user }, d) => recurring.linkTransaction(db, user.id, d.transactionId, d.ruleId));
}

/* ----------------------------------------------------------------- goals */

const goalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["emergency_fund", "car", "holiday", "laptop", "house_deposit", "education", "major_purchase", "custom"]),
  targetAmount: zCents.refine((n) => n > 0, "Target must be greater than zero"),
  targetDate: zDate.nullish().or(z.literal("")),
  priority: z.number().int().min(1).max(5).optional(),
  cadence: z.enum(["weekly", "fortnightly", "monthly"]).optional(),
  plannedContribution: zCents.nullish(),
  linkedAccountId: zId.nullish().or(z.literal("")),
  initialSaved: zCents.optional(),
});
export async function createGoalAction(input: z.infer<typeof goalSchema>) {
  return run(goalSchema, input, async ({ db, user, today }, d) =>
    (await goals.createGoal(db, user.id, { ...d, targetDate: d.targetDate || null, linkedAccountId: d.linkedAccountId || null }, today)).id,
  );
}
export async function updateGoalAction(input: Partial<z.infer<typeof goalSchema>> & { id: string }) {
  return run(goalSchema.partial().extend({ id: zId }), input, ({ db, user }, { id, ...d }) =>
    goals.updateGoal(db, user.id, id, {
      ...d,
      initialSaved: undefined,
      targetDate: d.targetDate === undefined ? undefined : d.targetDate || null,
      linkedAccountId: d.linkedAccountId === undefined ? undefined : d.linkedAccountId || null,
    }),
  );
}
export async function setGoalStatusAction(input: { id: string; status: "active" | "paused" | "completed" | "archived" }) {
  return run(z.object({ id: zId, status: z.enum(["active", "paused", "completed", "archived"]) }), input, ({ db, user }, d) => goals.setGoalStatus(db, user.id, d.id, d.status));
}
export async function deleteGoalAction(input: { id: string }) {
  return run(z.object({ id: zId }), input, ({ db, user }, d) => goals.deleteGoal(db, user.id, d.id));
}
const contrib = z.object({ goalId: zId, amount: zCents, date: zDate, note: z.string().max(200).nullish() });
export async function addContributionAction(input: z.infer<typeof contrib>) {
  return run(contrib, input, ({ db, user }, d) => goals.addContribution(db, user.id, d.goalId, d));
}
export async function deleteContributionAction(input: { id: string }) {
  return run(z.object({ id: zId }), input, ({ db, user }, d) => goals.deleteContribution(db, user.id, d.id));
}

/* ------------------------------------------------------------------ debt */

const debtFields = {
  kind: z.enum(["credit_card", "personal_loan", "student_loan", "vehicle", "mortgage", "other"]),
  lender: z.string().max(80).nullish(),
  aprBps: z.number().int().min(0).max(20000),
  aprIsEstimate: z.boolean().optional(),
  minimumPayment: zCents.refine((n) => n >= 0),
  dueDay: z.number().int().min(1).max(31).nullish(),
  notes: z.string().max(500).nullish(),
  rateChanges: z.array(z.object({ fromMonth: z.number().int().min(1).max(600), aprBps: z.number().int().min(0).max(20000) })).max(10).optional(),
};
const debtCreate = z.object({ ...debtFields, name: z.string().trim().min(1).max(60), balanceOwed: zCents.refine((n) => n >= 0), asOf: zDate, accountId: zId.nullish() });
export async function createDebtAction(input: z.infer<typeof debtCreate>) {
  return run(debtCreate, input, async ({ db, user, currency }, d) => {
    if (d.accountId) return (await debts.attachDebtProfile(db, user.id, d.accountId, d)).id;
    return (await debts.createDebtWithAccount(db, user.id, { ...d, currency })).id;
  });
}
const debtUpdate = z.object({ id: zId, ...debtFields, confirmedBalance: zCents.nullish(), confirmedBalanceDate: zDate.nullish() }).partial().required({ id: true });
export async function updateDebtAction(input: z.infer<typeof debtUpdate>) {
  return run(debtUpdate, input, ({ db, user }, { id, ...d }) => debts.updateDebt(db, user.id, id, d));
}
export async function deleteDebtAction(input: { id: string }) {
  return run(z.object({ id: zId }), input, ({ db, user }, d) => debts.deleteDebtProfile(db, user.id, d.id));
}

/* -------------------------------------------------------------- insights */

export async function dismissInsightAction(input: { key: string }) {
  return run(z.object({ key: z.string().min(1).max(200) }), input, ({ db, user }, d) => dismissInsight(db, user.id, d.key));
}
