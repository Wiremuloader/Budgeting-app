import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, CircleAlert, Info, Landmark, PiggyBank, Sparkles } from "lucide-react";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getOverview, type OverviewPeriod } from "@/server/services/overview";
import { evaluateNotifications } from "@/server/services/notify-eval";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Progress, buttonStyles } from "@/components/ui/primitives";
import { Money } from "@/components/money";
import { BudgetBar, CumulativeSpendChart, ForecastChart, IncomeSpendingChart, NetWorthChart, RankedBars } from "@/components/charts";
import { InsightList } from "./insights";
import { Checklist } from "./checklist";
import { formatMoney, formatBps } from "@/domain/money";
import { diffDays, formatDisplayDate, formatMonthKey, monthKey } from "@/domain/dates";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };

const PERIODS: { key: OverviewPeriod; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "3m", label: "3 months" },
  { key: "ytd", label: "Year to date" },
  { key: "12m", label: "12 months" },
];

function greeting(name: string, timeZone: string) {
  const first = name.split(" ")[0];
  const h = Number(new Intl.DateTimeFormat("en-NZ", { hour: "numeric", hour12: false, timeZone }).format(new Date()));
  return `${h < 12 ? "Morena" : h < 18 ? "Kia ora" : "Evening"}, ${first}`;
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { user, prefs, today, currency } = await requireContext();
  if (!prefs.onboardingCompletedAt) redirect("/onboarding");
  const sp = await searchParams;
  const period = (PERIODS.find((p) => p.key === sp.period)?.key ?? "month") as OverviewPeriod;
  const db = await getDb();
  const o = await getOverview(db, user.id, prefs, today, period);
  void evaluateNotifications(db, user.id, prefs, today);

  const safe = o.forecast.safe;
  const days = safe.daysUntilHorizon;
  const spendChange = o.summary.spending - o.previous.spending;
  const hasAccounts = o.accounts.length > 0;

  return (
    <>
      <PageHeader
        title={greeting(user.name, prefs.timezone)}
        description={`${formatDisplayDate(today, { weekday: true, year: true })} · figures in ${currency}`}
        actions={
          <nav aria-label="Period" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-surface-2 p-0.5 text-[13px]">
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={p.key === "month" ? "/overview" : `/overview?period=${p.key}`}
                aria-current={p.key === period ? "true" : undefined}
                className={cn("rounded-md px-2.5 py-1.5 font-medium", p.key === period ? "bg-surface text-text shadow-card" : "text-muted hover:text-text")}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        }
      />

      {o.checklist.visible && <Checklist items={o.checklist.items} done={o.checklist.done} total={o.checklist.total} />}

      {!hasAccounts ? (
        <Card>
          <EmptyState icon={<Landmark />} title="Add your first account" action={<Link href="/accounts?new=1" className={buttonStyles({ variant: "primary" })}>Add account</Link>}>
            Start with your everyday bank account. You can import transactions from your bank’s CSV export or enter them by hand.
          </EmptyState>
        </Card>
      ) : (
        <>
          {/* Headline figures — deliberately distinct concepts */}
          <section aria-label="Your money right now" className="grid gap-4 lg:grid-cols-[1.25fr_1fr_1fr]">
            <Card className="relative overflow-hidden p-5">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-muted">Safe to spend</p>
                <Badge tone="outline">Estimate</Badge>
              </div>
              <p className={cn("mt-2 font-display text-[52px] leading-none tracking-tight", safe.amount < 0 && "text-negative")}>
                <Money value={safe.amount} currency={currency} className="font-display" />
              </p>
              <p className="mt-2 text-sm text-text-2">
                {safe.horizonKind === "payday" ? (
                  <>
                    until payday {days <= 1 ? "tomorrow" : `in ${days} days`} ({formatDisplayDate(safe.horizon, { weekday: true })})
                    {safe.perDay !== null && (
                      <>
                        {" "}· about <Money value={safe.perDay} currency={currency} /> a day
                      </>
                    )}
                  </>
                ) : (
                  <>until the end of the month · add your income in Recurring to count down to payday</>
                )}
              </p>
              <details className="group mt-3 text-[13px] text-muted">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-text">
                  <Info className="size-3.5" /> How this is worked out
                </summary>
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md bg-surface-2 p-3">
                  <dt>Spendable accounts (incl. pending)</dt>
                  <dd className="text-right"><Money value={safe.spendableBalance} currency={currency} /></dd>
                  <dt>Bills due before {safe.horizonKind === "payday" ? "payday" : "month end"} ({safe.committedItems.length})</dt>
                  <dd className="text-right">−<Money value={safe.committed} currency={currency} /></dd>
                  <dt>Your safety buffer</dt>
                  <dd className="text-right">−<Money value={safe.buffer} currency={currency} /></dd>
                  <dt className="font-medium text-text">Safe to spend</dt>
                  <dd className="text-right font-medium text-text"><Money value={safe.amount} currency={currency} /></dd>
                </dl>
                <p className="mt-2">Expected income isn’t counted until it arrives. Everyday spending you haven’t made yet isn’t subtracted.</p>
              </details>
            </Card>

            <Card className="p-5">
              <p className="text-[13px] font-medium text-muted">Cash in your accounts</p>
              <p className="mt-2 text-[28px] font-semibold tracking-tight"><Money value={o.totals.cash} currency={currency} /></p>
              <p className="mt-1 text-[13px] text-muted">Everyday, savings and cash accounts</p>
              <div className="mt-4 border-t border-border pt-3">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">Net worth</span>
                  <Money value={o.totals.netWorth} currency={currency} className="font-medium" tone="negative" />
                </div>
                <div className="mt-1 flex items-baseline justify-between text-[13px]">
                  <span className="text-muted">Owed on cards & loans</span>
                  <Money value={o.totals.liabilities} currency={currency} className="font-medium" />
                </div>
                {o.goalsSavedTotal > 0 && (
                  <div className="mt-1 flex items-baseline justify-between text-[13px]">
                    <span className="text-muted">Set aside for goals</span>
                    <Money value={o.goalsSavedTotal} currency={currency} className="font-medium" />
                  </div>
                )}
                {o.totals.excludedAccountIds.length > 0 && <p className="mt-2 text-xs text-warning">{o.totals.excludedAccountIds.length} account(s) in another currency aren’t included.</p>}
              </div>
            </Card>

            <Card className="p-5">
              <p className="text-[13px] font-medium text-muted">{o.range.label}</p>
              <dl className="mt-3 space-y-2.5 text-sm">
                <div className="flex items-baseline justify-between">
                  <dt className="text-text-2">Earned</dt>
                  <dd><Money value={o.summary.income} currency={currency} className="text-[17px] font-semibold" /></dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-text-2">Spent</dt>
                  <dd className="text-right">
                    <Money value={o.summary.spending} currency={currency} className="text-[17px] font-semibold" />
                    <span className={cn("ml-2 text-xs", spendChange > 0 ? "text-negative" : "text-positive")} title="Compared with the same number of days in the previous period">
                      {spendChange === 0 ? "" : `${spendChange > 0 ? "▲" : "▼"} ${formatMoney(Math.abs(spendChange), currency, { compact: true })}`}
                    </span>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between">
                  <dt className="text-text-2">Saved</dt>
                  <dd>
                    <Money value={o.summary.net} currency={currency} tone="negative" className="text-[17px] font-semibold" />
                    <span className="ml-2 text-xs text-muted">{o.summary.savingsRateBps === null ? "" : `${formatBps(o.summary.savingsRateBps)} rate`}</span>
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted">
                Transfers and card repayments excluded.
                {o.summary.pendingSpending > 0 && <> Includes {formatMoney(o.summary.pendingSpending, currency)} pending.</>}
                {o.summary.uncategorisedInflows > 0 && (
                  <>
                    {" "}
                    <Link href="/transactions?type=uncategorised" className="text-accent hover:underline">
                      {formatMoney(o.summary.uncategorisedInflows, currency)} of deposits need a category
                    </Link>{" "}
                    before they count as income.
                  </>
                )}
              </p>
            </Card>
          </section>

          {o.insights.length > 0 && (
            <section aria-labelledby="insights-h" className="mt-6">
              <h2 id="insights-h" className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
                <Sparkles className="size-4 text-accent" /> What’s worth knowing
              </h2>
              <InsightList insights={o.insights} />
            </section>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Income and spending" description={period === "12m" || period === "ytd" ? "Last 12 months" : "Last 6 months"} />
              <CardBody>
                <IncomeSpendingChart data={o.trend.map((t) => ({ month: t.month, income: t.income, spending: t.spending, net: t.net }))} currency={currency} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Where your money went" description={o.range.label} action={<Link href={`/reports?from=${o.range.from}&to=${o.range.to}`} className="text-[13px] text-accent hover:underline">Details</Link>} />
              <CardBody>
                <RankedBars
                  currency={currency}
                  rows={o.categories.map((c) => ({ key: c.categoryId ?? "none", label: c.name, value: c.amount, previous: c.previous }))}
                  hrefTemplate={`/transactions?category={key}&from=${o.range.from}&to=${o.range.to}`}
                />
              </CardBody>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title={`Budget · ${formatMonthKey(monthKey(today))}`}
                description={
                  o.budget.hasAllocations ? (
                    <>
                      <Money value={o.budget.totalSpent} currency={currency} /> of <Money value={o.budget.totalBudgeted} currency={currency} /> spent
                    </>
                  ) : (
                    "No budget set for this month yet"
                  )
                }
                action={<Link href="/budget" className="text-[13px] text-accent hover:underline">Open budget</Link>}
              />
              <CardBody>
                {o.budget.categories.length === 0 ? (
                  <EmptyState title="Plan this month" action={<Link href="/budget" className={buttonStyles({ variant: "primary", size: "sm" })}>Set up budget</Link>} className="py-6">
                    Decide what each dollar is for, then track spending against it.
                  </EmptyState>
                ) : (
                  <>
                    {o.budget.method === "envelope" && o.budget.readyToAssign !== 0 && (
                      <Alert tone={o.budget.readyToAssign < 0 ? "negative" : "info"} className="mb-4">
                        {o.budget.readyToAssign > 0 ? (
                          <>
                            <Money value={o.budget.readyToAssign} currency={currency} className="font-semibold" /> is ready to assign to a category.
                          </>
                        ) : (
                          <>
                            You’ve assigned <Money value={-o.budget.readyToAssign} currency={currency} className="font-semibold" /> more than you have.
                          </>
                        )}
                      </Alert>
                    )}
                    <ul className="space-y-3.5">
                      {o.budget.categories
                        .sort((a, b) => (b.budgeted ? b.spent / b.budgeted : 2) - (a.budgeted ? a.spent / a.budgeted : 2))
                        .slice(0, 6)
                        .map((c) => (
                          <li key={c.id}>
                            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                              <span className="flex items-center gap-1.5 truncate">
                                {c.name}
                                {c.status === "over" && <Badge tone="negative"><CircleAlert className="size-3" />Over</Badge>}
                                {c.status === "warning" && (c.spent >= c.budgeted ? <Badge tone="neutral">Fully used</Badge> : <Badge tone="warning">Nearly there</Badge>)}
                              </span>
                              <span className="num shrink-0 text-muted">
                                <span className="font-medium text-text">{formatMoney(c.spent, currency, { compact: true })}</span> / {formatMoney(c.budgeted, currency, { compact: true })}
                              </span>
                            </div>
                            <BudgetBar spent={c.spent} budgeted={c.budgeted} projected={c.projected} label={`${c.name}: ${formatMoney(c.spent, currency)} spent of ${formatMoney(c.budgeted, currency)}`} />
                          </li>
                        ))}
                    </ul>
                    <p className="mt-4 text-xs text-muted">Pale fill shows projected month-end spending (an estimate).</p>
                  </>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Coming up" description="Confirmed bills and income, next 30 days" action={<Link href="/recurring" className="text-[13px] text-accent hover:underline">All recurring</Link>} />
              <CardBody>
                {o.overdue.length > 0 && (
                  <Alert tone="warning" className="mb-3" icon={<CircleAlert />}>
                    {o.overdue.length} scheduled item{o.overdue.length > 1 ? "s haven’t" : " hasn’t"} been matched to a transaction yet: {o.overdue.map((x) => x.name).join(", ")}.
                  </Alert>
                )}
                {o.bills.length === 0 ? (
                  <EmptyState icon={<CalendarClock />} title="No bills scheduled" action={<Link href="/recurring?new=bill" className={buttonStyles({ size: "sm" })}>Add a bill</Link>} className="py-6">
                    Add rent, power and subscriptions so Ledger can warn you before they’re due.
                  </EmptyState>
                ) : (
                  <ul className="divide-y divide-border">
                    {o.bills.map((b) => (
                      <li key={`${b.ruleId}-${b.date}`} className="flex items-center gap-3 py-2.5">
                        <div className="w-11 shrink-0 rounded-md bg-surface-2 py-1 text-center">
                          <p className="text-[10px] uppercase tracking-wide text-muted">{formatDisplayDate(b.date).split(" ")[1]}</p>
                          <p className="num text-[15px] font-semibold leading-tight">{b.date.slice(8)}</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{b.name}</p>
                          <p className="text-xs text-muted">{diffDays(today, b.date) === 0 ? "Due today" : `In ${diffDays(today, b.date)} days`}</p>
                        </div>
                        <Money value={-b.amount} currency={currency} className="text-sm font-medium" />
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader
                title="Next 30 days"
                description={
                  o.forecast.forecast.variable.sufficient
                    ? "Forecast spendable balance, with a range for higher or lower everyday spending"
                    : "Forecast — limited history, so the range is rough"
                }
                action={<Link href="/reports?tab=forecast" className="text-[13px] text-accent hover:underline">Forecast</Link>}
              />
              <CardBody>
                <ForecastChart
                  points={o.forecast.forecast.points}
                  currency={currency}
                  threshold={prefs.lowBalanceThreshold}
                  start={{ date: today, balance: o.forecast.forecast.startBalance }}
                  height={220}
                />
                <p className="mt-3 text-xs text-muted">
                  Lowest expected: <Money value={o.forecast.forecast.lowest.expected} currency={currency} /> on {formatDisplayDate(o.forecast.forecast.lowest.date)}. Estimates only — not guaranteed money.
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Spending pace" description="Cumulative spending this month vs last month" />
              <CardBody>
                <CumulativeSpendChart current={o.daily} previous={o.prevDaily} currency={currency} budget={o.budget.hasAllocations ? o.budget.totalBudgeted : undefined} height={220} />
              </CardBody>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Net worth" description="Assets minus liabilities at each month end" />
              <CardBody>
                <NetWorthChart data={o.netWorth} currency={currency} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Savings goals" action={<Link href="/goals" className="text-[13px] text-accent hover:underline">All goals</Link>} />
              <CardBody>
                {o.goals.length === 0 ? (
                  <EmptyState icon={<PiggyBank />} title="No goals yet" action={<Link href="/goals?new=1" className={buttonStyles({ size: "sm" })}>Create a goal</Link>} className="py-6">
                    An emergency fund is a good first one.
                  </EmptyState>
                ) : (
                  <ul className="space-y-4">
                    {o.goals.slice(0, 4).map((g) => (
                      <li key={g.id}>
                        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px]">
                          <span className="truncate font-medium">{g.name}</span>
                          <span className="num shrink-0 text-muted">
                            {formatMoney(g.savedAmount, currency, { compact: true })} / {formatMoney(g.targetAmount, currency, { compact: true })}
                          </span>
                        </div>
                        <Progress value={g.progress.progressBps} max={10000} label={`${g.name} progress`} />
                        <p className="mt-1 text-xs text-muted">
                          {g.status === "paused"
                            ? "Paused"
                            : g.progress.estimatedCompletion
                              ? `Estimated ${formatDisplayDate(g.progress.estimatedCompletion, { year: true })}${g.progress.onTrack === false ? " · behind target date" : ""}`
                              : "Add a regular contribution to see a completion date"}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
