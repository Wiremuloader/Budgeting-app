import type { Metadata } from "next";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listAccounts } from "@/server/services/accounts";
import { listRules } from "@/server/services/recurring";
import { listDebts } from "@/server/services/debts";
import { budgetPerformance, categoryBreakdown, dailySeries, dataCoverage, linesFor, merchantBreakdown, monthlySummaries, netWorthHistory } from "@/server/services/reports";
import { buildForecast } from "@/server/services/forecast";
import { ReportsView } from "./reports-view";
import { summarize, incomeByCategory } from "@/domain/ledger";
import { addDays, daysInclusive, isValidDate, monthKey, monthRange, previousRange } from "@/domain/dates";
import { isUuid } from "@/server/services/common";
import { listCategories } from "@/server/services/categories";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, prefs, today, currency } = await requireContext();
  const sp = await searchParams;
  const to = sp.to && isValidDate(sp.to) ? sp.to : today;
  let from = sp.from && isValidDate(sp.from) ? sp.from : `${monthKey(addDays(today, -150))}-01`;
  if (from > to) from = to;
  const accountId = isUuid(sp.account) ? sp.account : undefined;
  const filters = { accountIds: accountId ? [accountId] : undefined };
  const horizon = sp.days === "7" ? 7 : sp.days === "90" ? 90 : 30;
  const range = { from, to };
  const prev = previousRange(range);
  const months = monthRange(monthKey(from), monthKey(to)).slice(-36);

  const db = await getDb();
  const [accounts, cats, lines, prevLines, summaries, categories, merchants, netWorth, budget, daily, coverage, rules, debts, forecast] = await Promise.all([
    listAccounts(db, user.id, { includeArchived: true }),
    listCategories(db, user.id, { includeArchived: true }),
    linesFor(db, user.id, range, filters),
    linesFor(db, user.id, prev, filters),
    monthlySummaries(db, user.id, months, filters),
    categoryBreakdown(db, user.id, range, filters),
    merchantBreakdown(db, user.id, range, filters, 12),
    netWorthHistory(db, user.id, months, currency, today),
    budgetPerformance(db, user.id, months),
    daysInclusive(from, to) <= 120 ? dailySeries(db, user.id, range, filters) : Promise.resolve(null),
    dataCoverage(db, user.id),
    listRules(db, user.id, today),
    listDebts(db, user.id, today),
    buildForecast(db, user.id, today, horizon, { currency, safetyBuffer: prefs.safetyBuffer, lowBalanceThreshold: prefs.lowBalanceThreshold }),
  ]);
  const income = incomeByCategory(lines);

  return (
    <ReportsView
      currency={currency}
      today={today}
      range={range}
      previous={prev}
      tab={sp.tab ?? "summary"}
      accountId={accountId ?? ""}
      horizon={horizon}
      threshold={prefs.lowBalanceThreshold}
      accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      summary={summarize(lines)}
      previousSummary={summarize(prevLines)}
      monthly={summaries}
      categories={categories}
      merchants={merchants}
      incomeByCategory={[...income.entries()].map(([id, amount]) => ({ name: cats.find((c) => c.id === id)?.name ?? "Income", amount })).sort((a, b) => b.amount - a.amount)}
      netWorth={netWorth}
      budget={budget}
      daily={daily}
      coverage={coverage}
      recurring={rules.filter((r) => r.status === "active").map((r) => ({ name: r.name, kind: r.kind, monthly: r.monthlyCost, annual: r.annualCost }))}
      debts={debts.map((d) => ({ name: d.accountName, balance: d.balance, paid90: d.paidLast90Days }))}
      forecast={forecast.forecast}
      cardPayments={forecast.cardPayments}
    />
  );
}
