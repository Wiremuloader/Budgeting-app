import { and, eq } from "drizzle-orm";
import type { Queryable } from "../db";
import { debts, recurringRules } from "../db/schema";
import { listAccounts } from "./accounts";
import { forecastFlows, nextPayday } from "./recurring";
import { ledgerLines } from "./transactions";
import { estimateVariableSpending, expandFlows, forecastCashFlow, type ForecastResult, type ScheduledFlow } from "@/domain/forecast";
import { safeToSpend, type SafeToSpend } from "@/domain/safe-to-spend";
import { addDays, addMonths, monthEnd, monthKey, type ISODate } from "@/domain/dates";
import { sum } from "@/domain/money";

export interface ForecastBundle {
  forecast: ForecastResult;
  safe: SafeToSpend;
  accountIds: string[];
  payday: { date: ISODate; name: string; amount: number } | null;
  cardPayments: { account: string; date: ISODate; amount: number; estimatedDate: boolean }[];
}

function nextDueDate(today: ISODate, dueDay: number): ISODate {
  const thisMonth = addMonths(`${today.slice(0, 7)}-01`, 0, dueDay);
  return thisMonth > today ? thisMonth : addMonths(`${today.slice(0, 7)}-01`, 1, dueDay);
}

/**
 * Forecast for the user's spendable accounts in their main currency.
 *
 *  - Variable spending = last 12 weeks of non-recurring outflows from spendable
 *    accounts AND credit cards (card purchases are paid from cash eventually).
 *  - The balance currently owed on each credit card is scheduled as a payment on the
 *    card's due day (or, without one, in 25 days and labelled as estimated), unless a
 *    recurring transfer to that card already exists.
 */
export async function buildForecast(
  db: Queryable,
  userId: string,
  today: ISODate,
  days: number,
  opts: { currency: string; safetyBuffer: number; lowBalanceThreshold: number },
): Promise<ForecastBundle> {
  const all = await listAccounts(db, userId);
  const accounts = all.filter((a) => a.spendable && a.currency === opts.currency);
  const cards = all.filter((a) => a.type === "credit_card" && a.currency === opts.currency);
  const ids = new Set(accounts.map((a) => a.id));
  const startBalance = sum(accounts.map((a) => a.balance));
  const historyTo = today;
  const historyFrom = addDays(today, -83); // 12 full weeks
  const horizon = addDays(today, Math.max(days, 35));
  const spendSources = [...ids, ...cards.map((c) => c.id)];

  const [flows, lines, payday, cardDebts, cardRules] = await Promise.all([
    forecastFlows(db, userId, ids, addDays(today, 1), horizon),
    spendSources.length ? ledgerLines(db, userId, { from: historyFrom, to: historyTo }, { accountIds: spendSources, kinds: ["standard"] }) : Promise.resolve([]),
    nextPayday(db, userId, today),
    db.select({ accountId: debts.accountId, dueDay: debts.dueDay }).from(debts).where(eq(debts.userId, userId)),
    db
      .select({ to: recurringRules.toAccountId })
      .from(recurringRules)
      .where(and(eq(recurringRules.userId, userId), eq(recurringRules.status, "active"))),
  ]);

  const cardPayments: ForecastBundle["cardPayments"] = [];
  const extraFlows: ScheduledFlow[] = [];
  if (ids.size) {
    for (const card of cards) {
      if (card.balance >= 0 || cardRules.some((r) => r.to === card.id)) continue;
      const dueDay = cardDebts.find((d) => d.accountId === card.id)?.dueDay ?? null;
      const date = dueDay ? nextDueDate(today, dueDay) : addDays(today, 25);
      cardPayments.push({ account: card.name, date, amount: card.balance, estimatedDate: !dueDay });
      extraFlows.push({ amount: card.balance, label: `${card.name} payment${dueDay ? "" : " (estimated date)"}`, source: "planned", date });
    }
  }
  const allFlows = [...flows, ...extraFlows];

  const variableSpends = lines
    .filter((l) => l.amount < 0 && !l.recurringRuleId && l.categoryGroup !== "income")
    .map((l) => ({ date: l.date, amount: -l.amount }));
  const firstData = lines.length ? lines[0].date : today;
  const variable = estimateVariableSpending(variableSpends, firstData > historyFrom ? firstData : historyFrom, historyTo);

  const forecast = forecastCashFlow({ today, days, startBalance, flows: allFlows, variable, safetyThreshold: opts.lowBalanceThreshold });
  if (cardPayments.length) {
    forecast.assumptions.splice(2, 0, "What you currently owe on credit cards is scheduled as a payment on each card’s due date; new card spending is included in everyday spending.");
  }
  const events = expandFlows(allFlows, addDays(today, 1), horizon);
  const safe = safeToSpend({
    today,
    spendableBalance: startBalance,
    events,
    nextPayday: payday && payday.date > today ? payday.date : null,
    fallbackHorizon: monthEnd(monthKey(today)),
    safetyBuffer: opts.safetyBuffer,
  });
  return { forecast, safe, accountIds: [...ids], payday, cardPayments };
}
