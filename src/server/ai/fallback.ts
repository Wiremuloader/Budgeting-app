import { toolByName, type ToolContext } from "./tools";
import type { AssistantReply, ToolTrace } from "./assistant";
import { addMonthKey, formatDisplayDate, isValidDate, monthKey, monthStart } from "@/domain/dates";

const d = (v: unknown) => (typeof v === "string" && isValidDate(v) ? formatDisplayDate(v, { weekday: true }) : String(v));

/**
 * "Direct answers" mode, used when no AI provider is configured or it is unavailable.
 * A small keyword router picks one calculation tool and renders its result as text.
 * It never guesses: unrecognised questions get a list of what it can answer.
 */

type R = Record<string, unknown> & { [k: string]: unknown };

async function call(ctx: ToolContext, name: string, input: unknown, traces: ToolTrace[]): Promise<R> {
  const tool = toolByName(name)!;
  const parsed = tool.input.parse(input);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out = await tool.run(ctx, parsed as any);
  traces.push({ name, input: parsed, summary: out.summary, ok: true });
  return out.result as R;
}

const list = (items: string[]) => items.map((i) => `• ${i}`).join("\n");

export async function offlineAnswer(ctx: ToolContext, question: string, notice: string): Promise<AssistantReply> {
  const q = question.toLowerCase();
  const traces: ToolTrace[] = [];
  const reply = (answer: string): AssistantReply => ({ answer, tools: traces, proposals: [], mode: "direct", notice });
  const month = monthKey(ctx.today);

  try {
    const amount = q.match(/\$?\s?(\d[\d,]*(?:\.\d{1,2})?)/)?.[1];
    if (/afford|can i (spend|buy)/.test(q) && amount) {
      const r = await call(ctx, "check_affordability", { amount: amount.replace(/,/g, "") }, traces);
      return reply(
        r.fits
          ? `Based on your recorded balances and bills, ${r.purchase} fits: you'd have about ${r.leftAfterPurchase} safe to spend until ${d(r.until)}${r.perDayAfter ? ` (${r.perDayAfter}/day)` : ""}.\n\nThis is an estimate. ${r.note}`
          : `${r.purchase} is more than your current safe-to-spend of ${r.safeToSpendBefore} before ${d(r.until)}. You'd be ${String(r.leftAfterPurchase).replace("-", "")} short.\n\n${r.note}`,
      );
    }
    const cut = q.match(/(?:cut|reduce|spend less on|lower)\s+(?:my\s+)?([a-z& ]+?)\s+(?:spending\s+)?by\s+\$?\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:a|per|each)?\s*(week|month)?/);
    if (cut) {
      const r = await call(ctx, "simulate_spending_change", { category: cut[1].trim(), amount: cut[2].replace(/,/g, ""), per: (cut[3] as "week" | "month") ?? "week" }, traces);
      const impact = (r.goalImpact as { goal: string; ifAddedMonthly: string | null; currentEstimate: string | null }[]).filter((g) => g.ifAddedMonthly);
      return reply(
        `Cutting ${r.category} by ${r.change} would free up about ${r.monthlyEffect} a month, or ${r.yearlyEffect} a year.` +
          (impact.length ? `\n\nIf you put that towards your goals:\n${list(impact.map((g) => `${g.goal}: done by ${d(g.ifAddedMonthly)}${g.currentEstimate ? ` (currently ${d(g.currentEstimate)})` : ""}`))}` : "") +
          `\n\nThis is an estimate and assumes the change is kept up every ${cut[3] ?? "week"}.`,
      );
    }
    if (/safe to spend|set aside|before payday|until payday|payday/.test(q)) {
      const r = await call(ctx, "get_safe_to_spend", {}, traces);
      const bills = (r.billsBeforeThen as { name: string; date: string; amount: string }[]).map((b) => `${b.name} — ${b.amount} on ${d(b.date)}`);
      return reply(
        `Safe to spend until ${d(r.until)} (${r.untilKind}): ${r.safeToSpend}${r.perDay ? ` — about ${r.perDay} a day` : ""}.\n\nSpendable balance ${r.spendableBalance}, minus bills due before then (${r.billsTotal}) and your safety buffer (${r.safetyBuffer}).${bills.length ? `\n\nSet aside for:\n${list(bills)}` : ""}`,
      );
    }
    if (/subscription/.test(q)) {
      const r = await call(ctx, "get_subscriptions", {}, traces);
      const items = (r.items as { name: string; annualCost: string; schedule: string; expected: string }[]).slice(0, 8);
      if (!items.length) return reply("You don't have any confirmed subscriptions yet. Check Recurring → Suggestions for patterns Ledger has detected.");
      return reply(`Your recurring payments by yearly cost (total ${r.totalAnnual}/year):\n${list(items.map((i) => `${i.name}: ${i.expected} ${i.schedule.toLowerCase()} → ${i.annualCost}/year`))}`);
    }
    if (/bill|due|upcoming/.test(q)) {
      const r = await call(ctx, "get_upcoming_bills", { days: 14 }, traces);
      const items = (r.items as { name: string; date: string; expected: string; status: string }[]).filter((i) => i.status !== "paid");
      return reply(items.length ? `Coming up in the next 14 days:\n${list(items.map((i) => `${d(i.date)}: ${i.name} ${i.expected} (${i.status})`))}` : "No scheduled bills in the next 14 days.");
    }
    if (/compare|last (three|3) months|trend/.test(q)) {
      const months = [addMonthKey(month, -3), addMonthKey(month, -2), addMonthKey(month, -1)];
      const r = await call(ctx, "compare_months", { months }, traces);
      const rows = (r.months as { month: string; income: string; spending: string; net: string }[]).map((m) => `${m.month}: income ${m.income}, spending ${m.spending}, net ${m.net}`);
      return reply(`Your last three full months:\n${list(rows)}`);
    }
    if (/goal|save each|saving for/.test(q)) {
      const r = (await call(ctx, "get_goals", {}, traces)) as unknown as { name: string; saved: string; target: string; requiredPerPeriodToHitDate: string | null; cadence: string; estimatedCompletion: string | null }[];
      if (!r.length) return reply("You haven't set up any savings goals yet.");
      return reply(list(r.map((g) => `${g.name}: ${g.saved} of ${g.target}.${g.requiredPerPeriodToHitDate ? ` Needs ${g.requiredPerPeriodToHitDate} per ${g.cadence.replace("ly", "")} to hit the target date.` : ""}${g.estimatedCompletion ? ` Estimated completion ${d(g.estimatedCompletion)}.` : ""}`)));
    }
    if (/debt|loan|credit card|pay off/.test(q)) {
      const r = await call(ctx, "get_debt_payoff", {}, traces);
      const a = r.avalanche as { months: number | null; totalInterest: string };
      return reply(`With minimum payments plus no extra, the avalanche order clears your debts in ${a.months ?? "more than 50 years of"} months with about ${a.totalInterest} interest (estimate). See Debt for snowball vs avalanche with extra payments.`);
    }
    if (/balance|how much (money )?do i have|net worth/.test(q)) {
      const r = await call(ctx, "get_balances", {}, traces);
      const t = r.totals as Record<string, string>;
      return reply(`Cash across your accounts: ${t.cash} (${t.spendable} in spendable accounts). Net worth: ${t.netWorth} (assets ${t.assets}, liabilities ${t.liabilities}).`);
    }
    if (/largest|biggest|top|where.*money|spend more|why did i spend|spending/.test(q)) {
      const r = await call(ctx, "get_spending_summary", { from: monthStart(month), to: ctx.today, top: 5 }, traces);
      const cats = (r.topCategories as { name: string; spent: string; previousPeriod: string }[]).map((c) => `${c.name}: ${c.spent} (previous period ${c.previousPeriod})`);
      return reply(`This month so far you've spent ${r.spending} against income of ${r.income}.\n\nLargest categories:\n${list(cats)}`);
    }
  } catch {
    return reply("I couldn't calculate that just now. Please try again.");
  }
  return reply(
    `I can answer these directly from your data:\n${list([
      "Can I afford to spend $150 this weekend?",
      "How much is safe to spend before payday?",
      "What are my largest expense categories?",
      "Which subscriptions cost the most?",
      "What bills are coming up?",
      "Compare my last three months",
      "How are my savings goals tracking?",
    ])}`,
  );
}
