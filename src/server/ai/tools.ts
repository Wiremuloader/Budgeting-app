import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import type { Queryable } from "../db";
import { categories } from "../db/schema";
import type { Preferences } from "../auth/session";
import { accountTotals, listAccounts } from "../services/accounts";
import { getBudgetMonth } from "../services/budget";
import { buildForecast } from "../services/forecast";
import { listGoals } from "../services/goals";
import { listDebts, payoffPlan } from "../services/debts";
import { listRules, occurrences } from "../services/recurring";
import { categoryBreakdown, linesFor, merchantBreakdown } from "../services/reports";
import { listTransactions } from "../services/transactions";
import { summarize } from "@/domain/ledger";
import { formatMoney, mulDiv, parseAmount } from "@/domain/money";
import { addDays, isValidDate, isValidMonthKey, monthEnd, monthKey, monthStart, formatDisplayDate, type ISODate } from "@/domain/dates";
import { goalScenarios, type ContributionCadence } from "@/domain/goals";

/**
 * Read-only financial tools for the assistant.
 *
 * Every tool runs server-side with the authenticated user's id bound in — the model
 * can never choose whose data to read. Results contain pre-formatted money strings
 * computed by the calculation engine so the model never has to do arithmetic.
 * Only the minimum fields are returned (no account numbers, no raw descriptions).
 *
 * The single "mutation" tool, propose_budget_change, does NOT change anything: it
 * returns a proposal the user must confirm in the UI, which then calls an
 * authorised server action.
 */

export interface ToolContext {
  db: Queryable;
  userId: string;
  prefs: Preferences;
  today: ISODate;
}

export interface BudgetProposal {
  categoryId: string;
  categoryName: string;
  month: string;
  currentAmount: number;
  newAmount: number;
  reason: string;
}

export interface ToolOutcome {
  result: unknown;
  proposal?: BudgetProposal;
  summary: string;
}

interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  run: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolOutcome>;
}

const dateStr = z.string().refine(isValidDate, "Use YYYY-MM-DD");
const monthStr = z.string().refine(isValidMonthKey, "Use YYYY-MM");

function money(ctx: ToolContext, cents: number) {
  return formatMoney(cents, ctx.prefs.currency);
}

function def<S extends z.ZodType>(d: ToolDef<S>): ToolDef<S> {
  return d;
}

async function findCategory(ctx: ToolContext, name: string) {
  const rows = await ctx.db
    .select({ id: categories.id, name: categories.name, group: categories.group })
    .from(categories)
    .where(and(eq(categories.userId, ctx.userId), isNull(categories.archivedAt)));
  const n = name.trim().toLowerCase();
  return rows.find((r) => r.id === name) ?? rows.find((r) => r.name.toLowerCase() === n) ?? rows.find((r) => r.name.toLowerCase().includes(n)) ?? null;
}

export const TOOLS = [
  def({
    name: "get_balances",
    description:
      "Current account balances and totals: cash, spendable money, assets, liabilities and net worth, in the user's main currency. Use for 'how much money do I have'.",
    input: z.object({}).strict(),
    async run(ctx) {
      const accounts = await listAccounts(ctx.db, ctx.userId);
      const t = accountTotals(accounts, ctx.prefs.currency);
      return {
        summary: `Read ${accounts.length} account balances`,
        result: {
          accounts: accounts.map((a) => ({ name: a.name, type: a.type, currency: a.currency, balance: formatMoney(a.balance, a.currency), pending: formatMoney(a.pendingBalance, a.currency), spendable: a.spendable })),
          totals: { cash: money(ctx, t.cash), spendable: money(ctx, t.spendable), assets: money(ctx, t.assets), liabilities: money(ctx, t.liabilities), netWorth: money(ctx, t.netWorth) },
          note: t.excludedAccountIds.length ? "Some accounts use another currency and are excluded from totals (no conversion is applied)." : undefined,
        },
      };
    },
  }),
  def({
    name: "get_spending_summary",
    description:
      "Income, spending (net of refunds; transfers excluded), net and savings rate for a date range, with the top spending categories and merchants. Dates are inclusive YYYY-MM-DD.",
    input: z.object({ from: dateStr, to: dateStr, top: z.number().int().min(1).max(15).optional() }).strict(),
    async run(ctx, i) {
      const range = { from: i.from, to: i.to };
      const [lines, cats, merchants] = await Promise.all([
        linesFor(ctx.db, ctx.userId, range),
        categoryBreakdown(ctx.db, ctx.userId, range),
        merchantBreakdown(ctx.db, ctx.userId, range, {}, i.top ?? 5),
      ]);
      const s = summarize(lines);
      return {
        summary: `Summarised ${i.from} to ${i.to}`,
        result: {
          period: range,
          income: money(ctx, s.income),
          spending: money(ctx, s.spending),
          net: money(ctx, s.net),
          savingsRate: s.savingsRateBps === null ? "n/a (no income recorded)" : `${(s.savingsRateBps / 100).toFixed(1)}%`,
          refundsIncluded: money(ctx, s.refunds),
          pendingIncluded: money(ctx, s.pendingSpending),
          uncategorisedSpending: money(ctx, s.uncategorisedOutflows),
          unreviewedInflowsNotCountedAsIncome: money(ctx, s.uncategorisedInflows),
          topCategories: cats.slice(0, i.top ?? 5).map((c) => ({ id: c.categoryId, name: c.name, spent: money(ctx, c.amount), share: c.shareBps === null ? null : `${(c.shareBps / 100).toFixed(1)}%`, previousPeriod: money(ctx, c.previous) })),
          topMerchants: merchants.map((m) => ({ merchant: m.merchant, spent: money(ctx, m.amount), transactions: m.count })),
        },
      };
    },
  }),
  def({
    name: "compare_months",
    description: "Compare income, spending and the largest category changes across up to 6 calendar months (YYYY-MM).",
    input: z.object({ months: z.array(monthStr).min(2).max(6) }).strict(),
    async run(ctx, i) {
      const out = [];
      for (const m of [...i.months].sort()) {
        const range = { from: monthStart(m), to: monthEnd(m) > ctx.today ? ctx.today : monthEnd(m) };
        const [lines, cats] = await Promise.all([linesFor(ctx.db, ctx.userId, range), categoryBreakdown(ctx.db, ctx.userId, range)]);
        const s = summarize(lines);
        out.push({
          month: m,
          partial: monthEnd(m) > ctx.today,
          income: money(ctx, s.income),
          spending: money(ctx, s.spending),
          net: money(ctx, s.net),
          topCategories: cats.slice(0, 5).map((c) => ({ name: c.name, spent: money(ctx, c.amount), changeVsPreviousMonth: formatMoney(c.change, ctx.prefs.currency, { signed: true }) })),
        });
      }
      return { summary: `Compared ${i.months.length} months`, result: { months: out } };
    },
  }),
  def({
    name: "get_safe_to_spend",
    description:
      "Estimated money safe to spend until the next expected payday: spendable balance minus confirmed bills due before payday minus the user's safety buffer. Also returns the next payday. Use for affordability questions.",
    input: z.object({}).strict(),
    async run(ctx) {
      const f = await buildForecast(ctx.db, ctx.userId, ctx.today, 30, { currency: ctx.prefs.currency, safetyBuffer: ctx.prefs.safetyBuffer, lowBalanceThreshold: ctx.prefs.lowBalanceThreshold });
      const s = f.safe;
      return {
        summary: "Calculated safe-to-spend",
        result: {
          safeToSpend: money(ctx, s.amount),
          perDay: s.perDay === null ? null : money(ctx, s.perDay),
          until: s.horizon,
          untilKind: s.horizonKind === "payday" ? "next expected payday" : "end of month (no recurring income on file)",
          daysUntil: s.daysUntilHorizon,
          spendableBalance: money(ctx, s.spendableBalance),
          billsBeforeThen: s.committedItems.map((e) => ({ name: e.label, date: e.date, amount: money(ctx, -e.amount) })),
          billsTotal: money(ctx, s.committed),
          safetyBuffer: money(ctx, s.buffer),
          nextPayday: f.payday ? { name: f.payday.name, date: f.payday.date, expected: money(ctx, f.payday.amount) } : null,
          basis: "estimate — excludes day-to-day spending you haven't made yet",
        },
      };
    },
  }),
  def({
    name: "check_affordability",
    description: "Check whether a specific purchase amount fits in safe-to-spend before the next payday. amount is a decimal string like \"150\" or \"89.90\".",
    input: z.object({ amount: z.string().max(20) }).strict(),
    async run(ctx, i) {
      const cents = Math.abs(parseAmount(i.amount, ctx.prefs.currency));
      const f = await buildForecast(ctx.db, ctx.userId, ctx.today, 30, { currency: ctx.prefs.currency, safetyBuffer: ctx.prefs.safetyBuffer, lowBalanceThreshold: ctx.prefs.lowBalanceThreshold });
      const left = f.safe.amount - cents;
      const days = Math.max(f.safe.daysUntilHorizon, 1);
      return {
        summary: `Checked affordability of ${money(ctx, cents)}`,
        result: {
          purchase: money(ctx, cents),
          safeToSpendBefore: money(ctx, f.safe.amount),
          leftAfterPurchase: money(ctx, left),
          fits: left >= 0,
          perDayAfter: left > 0 ? money(ctx, Math.floor(left / days)) : null,
          until: f.safe.horizon,
          expectedVariableSpendingPerDay: money(ctx, f.forecast.variable.dailyExpected),
          note: "Safe-to-spend already subtracts confirmed bills and the safety buffer, but not everyday spending you haven't made yet.",
        },
      };
    },
  }),
  def({
    name: "get_upcoming_bills",
    description: "Scheduled recurring bills, subscriptions and income in the next N days, with paid/upcoming/late status.",
    input: z.object({ days: z.number().int().min(1).max(90) }).strict(),
    async run(ctx, i) {
      const occ = await occurrences(ctx.db, ctx.userId, addDays(ctx.today, -3), addDays(ctx.today, i.days), ctx.today);
      return {
        summary: `Listed recurring items for ${i.days} days`,
        result: {
          items: occ.map((o) => ({ name: o.name, kind: o.kind, date: o.date, expected: formatMoney(o.amount, ctx.prefs.currency, { signed: true }), status: o.status })),
          totalOutflows: money(ctx, -occ.filter((o) => o.amount < 0 && o.status !== "paid" && o.date >= ctx.today).reduce((a, o) => a + o.amount, 0)),
        },
      };
    },
  }),
  def({
    name: "get_subscriptions",
    description: "Confirmed recurring subscriptions and bills with frequency, expected amount, annualised cost and price changes, sorted by annual cost.",
    input: z.object({}).strict(),
    async run(ctx) {
      const rules = (await listRules(ctx.db, ctx.userId, ctx.today)).filter((r) => r.kind !== "income" && r.kind !== "transfer");
      rules.sort((a, b) => b.annualCost - a.annualCost);
      return {
        summary: `Listed ${rules.length} recurring payments`,
        result: {
          items: rules.map((r) => ({ name: r.name, kind: r.kind, status: r.status, schedule: r.schedule, expected: money(ctx, -r.amount), annualCost: money(ctx, r.annualCost), next: r.next, lastCharged: r.lastMatched ? money(ctx, -r.lastMatched.amount) : null, priceChanged: r.amountChanged })),
          totalAnnual: money(ctx, rules.filter((r) => r.status === "active").reduce((a, r) => a + r.annualCost, 0)),
        },
      };
    },
  }),
  def({
    name: "get_budget_status",
    description: "Budget for a month (YYYY-MM): per category budgeted, spent, remaining, projected end-of-month spend and status; plus ready-to-assign for envelope budgets.",
    input: z.object({ month: monthStr }).strict(),
    async run(ctx, i) {
      const b = await getBudgetMonth(ctx.db, ctx.userId, i.month, ctx.prefs, ctx.today);
      return {
        summary: `Read the ${i.month} budget`,
        result: {
          method: b.method,
          readyToAssign: b.method === "envelope" ? money(ctx, b.readyToAssign) : undefined,
          totalBudgeted: money(ctx, b.totalAssigned),
          totalSpent: money(ctx, b.totalSpent),
          categories: b.categories
            .filter((c) => c.assigned || c.spent || c.carryIn)
            .map((c) => ({ id: c.id, name: c.name, budgeted: money(ctx, c.assigned + c.carryIn), spent: money(ctx, c.spent), remaining: money(ctx, c.available), status: c.status, projectedMonthEnd: c.projected === null ? null : money(ctx, c.projected) })),
        },
      };
    },
  }),
  def({
    name: "get_goals",
    description: "Savings goals with target, saved, remaining, target date, planned contribution, required contribution per period and estimated completion.",
    input: z.object({}).strict(),
    async run(ctx) {
      const goals = await listGoals(ctx.db, ctx.userId, ctx.today);
      return {
        summary: `Read ${goals.length} goals`,
        result: goals.map((g) => ({
          id: g.id,
          name: g.name,
          status: g.status,
          target: money(ctx, g.targetAmount),
          saved: money(ctx, g.savedAmount),
          remaining: money(ctx, g.progress.remaining),
          progress: `${(g.progress.progressBps / 100).toFixed(0)}%`,
          targetDate: g.targetDate,
          cadence: g.cadence,
          plannedContribution: g.plannedContribution ? money(ctx, g.plannedContribution) : null,
          requiredPerPeriodToHitDate: g.progress.requiredPerPeriod === null ? null : money(ctx, g.progress.requiredPerPeriod),
          estimatedCompletion: g.progress.estimatedCompletion,
          onTrack: g.progress.onTrack,
        })),
      };
    },
  }),
  def({
    name: "simulate_goal_contribution",
    description: "Estimate completion date for a savings goal if the user contributes a given amount per weekly, fortnightly or monthly period.",
    input: z.object({ goal: z.string().max(100), contribution: z.string().max(20), cadence: z.enum(["weekly", "fortnightly", "monthly"]) }).strict(),
    async run(ctx, i) {
      const goals = await listGoals(ctx.db, ctx.userId, ctx.today);
      const g = goals.find((x) => x.id === i.goal) ?? goals.find((x) => x.name.toLowerCase().includes(i.goal.toLowerCase()));
      if (!g) return { summary: "Goal not found", result: { error: "No goal matches that name", goals: goals.map((x) => x.name) } };
      const c = Math.abs(parseAmount(i.contribution, ctx.prefs.currency));
      const [s] = goalScenarios({ targetAmount: g.targetAmount, savedAmount: g.savedAmount, plannedContribution: g.plannedContribution, cadence: i.cadence as ContributionCadence }, ctx.today, [c]);
      return {
        summary: `Simulated ${g.name}`,
        result: { goal: g.name, remaining: money(ctx, g.progress.remaining), contribution: `${money(ctx, c)} per ${i.cadence.replace("ly", "")}`, periodsNeeded: s.periods, estimatedCompletion: s.completion, targetDate: g.targetDate, meetsTargetDate: g.targetDate && s.completion ? s.completion <= g.targetDate : null, basis: "estimate assuming the contribution is made every period" },
      };
    },
  }),
  def({
    name: "simulate_spending_change",
    description: "Estimate the monthly and yearly effect of changing spending in a category by a weekly or monthly amount (e.g. reduce takeaway by $40 a week). amount is a decimal string; positive = reduce spending.",
    input: z.object({ category: z.string().max(100), amount: z.string().max(20), per: z.enum(["week", "month"]) }).strict(),
    async run(ctx, i) {
      const cat = await findCategory(ctx, i.category);
      const amt = parseAmount(i.amount, ctx.prefs.currency);
      const monthly = i.per === "week" ? mulDiv(amt, 52, 12) : amt;
      const yearly = i.per === "week" ? mulDiv(amt, 52, 1) : mulDiv(amt, 12, 1);
      const from = monthStart(monthKey(addDays(ctx.today, -90)));
      const lines = cat ? (await linesFor(ctx.db, ctx.userId, { from, to: ctx.today })).filter((l) => l.categoryId === cat.id) : [];
      const recent = -lines.reduce((a, l) => a + l.amount, 0);
      const goals = (await listGoals(ctx.db, ctx.userId, ctx.today)).filter((g) => g.status === "active" && g.progress.remaining > 0);
      return {
        summary: `Simulated a change to ${cat?.name ?? i.category}`,
        result: {
          category: cat?.name ?? `${i.category} (no matching category)`,
          change: `${money(ctx, amt)} per ${i.per}`,
          monthlyEffect: money(ctx, monthly),
          yearlyEffect: money(ctx, yearly),
          recentSpendingInCategory: { since: from, total: money(ctx, recent) },
          exceedsRecentSpending: cat ? monthly * 3 > recent : null,
          goalImpact: goals.slice(0, 3).map((g) => {
            const [s] = goalScenarios({ targetAmount: g.targetAmount, savedAmount: g.savedAmount, plannedContribution: g.plannedContribution, cadence: "monthly" }, ctx.today, [Math.max((g.plannedContribution ?? 0) + monthly, 1)]);
            return { goal: g.name, ifAddedMonthly: s.completion, currentEstimate: g.progress.estimatedCompletion };
          }),
          basis: "estimate; assumes the change is sustained every period",
        },
      };
    },
  }),
  def({
    name: "get_cash_flow_forecast",
    description: "Forecast of spendable balance over 7, 30 or 90 days (optimistic/expected/conservative), with the lowest point and any shortfall.",
    input: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }).strict(),
    async run(ctx, i) {
      const f = await buildForecast(ctx.db, ctx.userId, ctx.today, i.days, { currency: ctx.prefs.currency, safetyBuffer: ctx.prefs.safetyBuffer, lowBalanceThreshold: ctx.prefs.lowBalanceThreshold });
      const end = f.forecast.points.at(-1)!;
      return {
        summary: `Forecast ${i.days} days`,
        result: {
          start: money(ctx, f.forecast.startBalance),
          end: { optimistic: money(ctx, end.optimistic), expected: money(ctx, end.expected), conservative: money(ctx, end.conservative) },
          lowest: { date: f.forecast.lowest.date, expected: money(ctx, f.forecast.lowest.expected) },
          shortfall: f.forecast.shortfall,
          assumptions: f.forecast.assumptions,
        },
      };
    },
  }),
  def({
    name: "get_debt_payoff",
    description: "Debts with balances and rates, plus avalanche vs snowball payoff projections for an optional extra monthly payment (decimal string).",
    input: z.object({ extraMonthly: z.string().max(20).optional() }).strict(),
    async run(ctx, i) {
      const debts = await listDebts(ctx.db, ctx.userId, ctx.today);
      const extra = i.extraMonthly ? Math.abs(parseAmount(i.extraMonthly, ctx.prefs.currency)) : 0;
      const p = payoffPlan(debts, extra);
      const fmt = (r: typeof p.avalanche) => ({ months: r.months, totalInterest: money(ctx, r.totalInterest), monthlyPayment: money(ctx, r.monthlyPayment), warnings: r.warnings });
      return {
        summary: `Projected ${debts.length} debts`,
        result: {
          debts: debts.map((d) => ({ name: d.accountName, kind: d.kind, balance: money(ctx, d.balance), rate: `${(d.aprBps / 100).toFixed(2)}%${d.aprIsEstimate ? " (user estimate)" : ""}`, minimum: money(ctx, d.minimumPayment) })),
          extraMonthly: money(ctx, extra),
          minimumOnly: fmt(p.minimum),
          avalanche: fmt(p.avalanche),
          snowball: fmt(p.snowball),
          assumptions: p.assumptions,
        },
      };
    },
  }),
  def({
    name: "search_transactions",
    description: "Find up to 20 transactions by merchant or note text and optional date range. Returns date, merchant, category, account and amount only.",
    input: z.object({ query: z.string().max(80).optional(), from: dateStr.optional(), to: dateStr.optional(), category: z.string().max(100).optional(), limit: z.number().int().min(1).max(20).optional() }).strict(),
    async run(ctx, i) {
      const cat = i.category ? await findCategory(ctx, i.category) : null;
      const res = await listTransactions(ctx.db, ctx.userId, { q: i.query, from: i.from, to: i.to, categoryId: cat?.id, pageSize: i.limit ?? 10 });
      return {
        summary: `Searched transactions (${res.total} matches)`,
        result: {
          totalMatches: res.total,
          totalIn: money(ctx, res.inflow),
          totalOut: money(ctx, -res.outflow),
          transactions: res.items.map((t) => ({ date: t.date, merchant: t.merchant, category: t.kind === "transfer" ? "Transfer" : (t.categoryName ?? (t.splits.length ? "Split" : "Uncategorised")), account: t.accountName, amount: formatMoney(t.amount, t.currency, { signed: true }), status: t.status })),
        },
      };
    },
  }),
  def({
    name: "propose_budget_change",
    description:
      "Propose changing a category's budget for a month. This does NOT change anything — the user sees a confirmation button and decides. newAmount is a decimal string.",
    input: z.object({ category: z.string().max(100), month: monthStr, newAmount: z.string().max(20), reason: z.string().max(300) }).strict(),
    async run(ctx, i) {
      const cat = await findCategory(ctx, i.category);
      if (!cat || cat.group !== "expense") return { summary: "Category not found", result: { error: "No matching spending category" } };
      const amount = Math.abs(parseAmount(i.newAmount, ctx.prefs.currency));
      const b = await getBudgetMonth(ctx.db, ctx.userId, i.month, ctx.prefs, ctx.today);
      const current = b.categories.find((c) => c.id === cat.id)?.assigned ?? 0;
      const proposal: BudgetProposal = { categoryId: cat.id, categoryName: cat.name, month: i.month, currentAmount: current, newAmount: amount, reason: i.reason };
      return {
        summary: `Proposed ${cat.name} budget change`,
        proposal,
        result: { status: "awaiting user confirmation — nothing has been changed", category: cat.name, month: i.month, current: money(ctx, current), proposed: money(ctx, amount) },
      };
    },
  }),
];

export type ToolName = (typeof TOOLS)[number]["name"];

export function toolByName(name: string) {
  return TOOLS.find((t) => t.name === name);
}

export function describeDate(d: ISODate) {
  return formatDisplayDate(d, { weekday: true, year: true });
}
