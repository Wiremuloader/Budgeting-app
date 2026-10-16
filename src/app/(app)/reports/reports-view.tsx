"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, Info, Printer } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, Select, buttonStyles } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { Delta, Money } from "@/components/money";
import { ChartFrame, ForecastChart, IncomeSpendingChart, Legend, NetWorthChart, RankedBars, compactDollars } from "@/components/charts";
import type { PeriodSummary } from "@/domain/ledger";
import type { BudgetPerformanceRow, CategoryBreakdownRow, DailyPoint, DataCoverage, MerchantRow, MonthSummary, NetWorthPoint } from "@/server/services/reports";
import type { ForecastResult } from "@/domain/forecast";
import { addMonthKey, formatDisplayDate, formatMonthKey, monthEnd, monthKey, monthStart, shortMonth, type DateRange } from "@/domain/dates";
import { formatBps, formatMoney } from "@/domain/money";

interface Props {
  currency: string;
  today: string;
  range: DateRange;
  previous: DateRange;
  tab: string;
  accountId: string;
  horizon: number;
  threshold: number;
  accounts: { id: string; name: string }[];
  summary: PeriodSummary;
  previousSummary: PeriodSummary;
  monthly: MonthSummary[];
  categories: CategoryBreakdownRow[];
  merchants: MerchantRow[];
  incomeByCategory: { name: string; amount: number }[];
  netWorth: NetWorthPoint[];
  budget: BudgetPerformanceRow[];
  daily: DailyPoint[] | null;
  coverage: DataCoverage;
  recurring: { name: string; kind: string; monthly: number; annual: number }[];
  debts: { name: string; balance: number; paid90: number }[];
  forecast: ForecastResult;
  cardPayments: { account: string; date: string; amount: number; estimatedDate: boolean }[];
}

const DEFINITIONS: [string, string][] = [
  ["Income", "Money in, in income categories (salary, benefits, interest…). Transfers from your own accounts, balance adjustments and deposits you haven’t categorised are not income."],
  ["Spending", "Money out in spending categories, minus refunds, plus uncategorised outflows. Transfers between your accounts — including credit-card payments and loan repayments — are not spending; the card purchases themselves were already counted."],
  ["Refunds", "Money back in a spending category. Refunds reduce that category’s spending rather than counting as income."],
  ["Net", "Income minus spending."],
  ["Savings rate", "Net ÷ income. Money moved into savings, KiwiSaver or investments, and loan principal you repay, counts as saved because it’s a transfer, not spending. Interest and fees count as spending."],
  ["Net worth", "Assets minus liabilities at each month end, for accounts marked “include in net worth”, in your main currency. Other currencies are not converted."],
  ["Pending", "Transactions your bank hasn’t settled yet are included and shown separately, because the money is already committed."],
];

export function ReportsView(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const nav = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const m = monthKey(p.today);
  const presets: { label: string; from: string; to: string }[] = [
    { label: "This month", from: monthStart(m), to: p.today },
    { label: "Last month", from: monthStart(addMonthKey(m, -1)), to: monthEnd(addMonthKey(m, -1)) },
    { label: "Last 3 months", from: monthStart(addMonthKey(m, -2)), to: p.today },
    { label: "Last 6 months", from: monthStart(addMonthKey(m, -5)), to: p.today },
    { label: "Year to date", from: `${p.today.slice(0, 4)}-01-01`, to: p.today },
    { label: "Last 12 months", from: monthStart(addMonthKey(m, -11)), to: p.today },
  ];
  const active = presets.find((x) => x.from === p.range.from && x.to === p.range.to);
  const exportQs = new URLSearchParams({ from: p.range.from, to: p.range.to, ...(p.accountId ? { account: p.accountId } : {}) }).toString();
  const fewMonths = p.coverage.months < 3;

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${formatDisplayDate(p.range.from, { year: true })} – ${formatDisplayDate(p.range.to, { year: true })}, compared with ${formatDisplayDate(p.previous.from, { year: true })} – ${formatDisplayDate(p.previous.to, { year: true })}`}
        actions={
          <>
            <a href={`/api/export/report?${exportQs}`} className={buttonStyles({ size: "sm" })}><Download /> CSV</a>
            <Button size="sm" onClick={() => window.print()}><Printer /> Print</Button>
          </>
        }
      />

      {/* One filter row, above everything it scopes */}
      <div className="no-print mb-5 flex flex-wrap items-end gap-2">
        <Select aria-label="Date range" className="w-auto" value={active?.label ?? "custom"} onChange={(e) => { const x = presets.find((q) => q.label === e.target.value); if (x) nav({ from: x.from, to: x.to }); }}>
          {presets.map((x) => <option key={x.label} value={x.label}>{x.label}</option>)}
          <option value="custom" disabled>Custom range</option>
        </Select>
        <label className="grid gap-1 text-xs text-muted">From<Input type="date" value={p.range.from} max={p.range.to} onChange={(e) => e.target.value && nav({ from: e.target.value })} /></label>
        <label className="grid gap-1 text-xs text-muted">To<Input type="date" value={p.range.to} min={p.range.from} max={p.today} onChange={(e) => e.target.value && nav({ to: e.target.value })} /></label>
        <Select aria-label="Account" className="w-auto" value={p.accountId} onChange={(e) => nav({ account: e.target.value })}>
          <option value="">All accounts</option>
          {p.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </div>

      {fewMonths && (
        <Alert tone="info" icon={<Info />} className="mb-4">
          You have {p.coverage.months} month{p.coverage.months === 1 ? "" : "s"} of history. Trends and averages become meaningful after about three months, so treat comparisons as early signals.
        </Alert>
      )}

      <Tabs value={p.tab} onValueChange={(v) => nav({ tab: v })}>
        <TabsList className="no-print mb-4 flex-wrap h-auto">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="spending">Spending</TabsTrigger>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="networth">Net worth & debt</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="cashflow">Cash flow</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Income" value={p.summary.income} prev={p.previousSummary.income} currency={p.currency} />
            <Metric label="Spending" value={p.summary.spending} prev={p.previousSummary.spending} currency={p.currency} inverse />
            <Metric label="Net" value={p.summary.net} prev={p.previousSummary.net} currency={p.currency} />
            <Card className="p-4">
              <p className="text-[13px] text-muted">Savings rate</p>
              <p className="mt-1 text-2xl font-semibold">{formatBps(p.summary.savingsRateBps, 1)}</p>
              <p className="text-xs text-muted">Previous {formatBps(p.previousSummary.savingsRateBps, 1)}</p>
            </Card>
          </div>
          <Card>
            <CardHeader title="Month by month" />
            <CardBody>
              <IncomeSpendingChart data={p.monthly.map((x) => ({ month: x.month, income: x.income, spending: x.spending, net: x.net }))} currency={p.currency} />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-border"><th className="py-2 font-medium">Month</th><th className="py-2 text-right font-medium">Income</th><th className="py-2 text-right font-medium">Spending</th><th className="py-2 text-right font-medium">Net</th><th className="py-2 text-right font-medium">Savings rate</th><th className="py-2 text-right font-medium">Transactions</th></tr>
                  </thead>
                  <tbody>
                    {p.monthly.map((x) => (
                      <tr key={x.month} className="border-b border-border last:border-0">
                        <td className="py-2">{formatMonthKey(x.month)}{x.month === monthKey(p.today) && <Badge className="ml-2">So far</Badge>}</td>
                        <td className="py-2 text-right"><Money value={x.income} currency={p.currency} /></td>
                        <td className="py-2 text-right"><Money value={x.spending} currency={p.currency} /></td>
                        <td className="py-2 text-right"><Money value={x.net} currency={p.currency} tone="auto" /></td>
                        <td className="num py-2 text-right">{formatBps(x.savingsRateBps)}</td>
                        <td className="num py-2 text-right text-muted">{x.transactionCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
          <Definitions />
        </TabsContent>

        <TabsContent value="spending" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="By category" description="Compared with the previous period of the same length" />
            <CardBody>
              <RankedBars currency={p.currency} max={15} rows={p.categories.map((c) => ({ key: c.categoryId ?? "none", label: c.name, value: c.amount, previous: c.previous }))} hrefTemplate={`/transactions?category={key}&from=${p.range.from}&to=${p.range.to}`} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Top merchants" />
            <CardBody>
              <ul className="divide-y divide-border text-sm">
                {p.merchants.map((x) => (
                  <li key={x.merchantKey} className="flex items-center justify-between gap-3 py-2">
                    <a href={`/transactions?q=${encodeURIComponent(x.merchant)}&from=${p.range.from}&to=${p.range.to}`} className="truncate hover:underline">{x.merchant}</a>
                    <span className="text-right">
                      <Money value={x.amount} currency={p.currency} className="font-medium" />
                      <span className="block text-[11px] text-muted">{x.count}× · avg {formatMoney(x.average, p.currency)}</span>
                    </span>
                  </li>
                ))}
                {!p.merchants.length && <li className="py-6 text-center text-muted">No spending in this period.</li>}
              </ul>
            </CardBody>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Recurring expenses" description="Active bills and subscriptions, as monthly and yearly cost" />
            <CardBody>
              <ul className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                {p.recurring.filter((r) => r.kind !== "income" && r.kind !== "transfer").sort((a, b) => b.annual - a.annual).map((r) => (
                  <li key={r.name} className="flex justify-between gap-3 border-b border-border py-1.5">
                    <span>{r.name}</span>
                    <span className="num text-right"><Money value={r.monthly} currency={p.currency} /> /mo <span className="text-muted">· {formatMoney(r.annual, p.currency, { compact: true })}/yr</span></span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="income" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Income by source" />
            <CardBody>
              <RankedBars currency={p.currency} rows={p.incomeByCategory.map((x) => ({ key: x.name, label: x.name, value: x.amount }))} />
              {p.summary.uncategorisedInflows > 0 && <p className="mt-3 text-xs text-muted">{formatMoney(p.summary.uncategorisedInflows, p.currency)} of uncategorised deposits aren’t counted as income.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Income trend" />
            <CardBody>
              <SingleBars data={p.monthly.map((x) => ({ label: x.month, value: x.income }))} currency={p.currency} name="Income" />
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="networth" className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <Card>
            <CardHeader title="Net worth" description="Month-end assets minus liabilities, from your recorded transactions" />
            <CardBody><NetWorthChart data={p.netWorth} currency={p.currency} height={260} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Debt progress" />
            <CardBody>
              {p.netWorth.length > 1 && (
                <p className="mb-3 text-sm">
                  Total debt went from <Money value={p.netWorth[0].debt} currency={p.currency} /> to <Money value={p.netWorth[p.netWorth.length - 1].debt} currency={p.currency} className="font-semibold" />.
                </p>
              )}
              <ul className="divide-y divide-border text-sm">
                {p.debts.map((d) => (
                  <li key={d.name} className="flex justify-between py-2"><span>{d.name}</span><span className="text-right"><Money value={d.balance} currency={p.currency} /><span className="block text-[11px] text-muted">paid {formatMoney(d.paid90, p.currency)} in 90 days</span></span></li>
                ))}
                {!p.debts.length && <li className="py-6 text-center text-muted">No debts recorded.</li>}
              </ul>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="budget">
          <Card>
            <CardHeader title="Budget performance" description="Total budgeted vs spent in budgeted categories each month" />
            <CardBody>
              {p.budget.every((b) => b.assigned === 0) ? (
                <p className="py-8 text-center text-sm text-muted">No budgets set in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted"><tr className="border-b border-border"><th className="py-2 font-medium">Month</th><th className="py-2 text-right font-medium">Budgeted</th><th className="py-2 text-right font-medium">Spent</th><th className="py-2 text-right font-medium">Difference</th></tr></thead>
                  <tbody>
                    {p.budget.map((b) => (
                      <tr key={b.month} className="border-b border-border last:border-0">
                        <td className="py-2">{formatMonthKey(b.month)}</td>
                        <td className="py-2 text-right"><Money value={b.assigned} currency={p.currency} /></td>
                        <td className="py-2 text-right"><Money value={b.spent} currency={p.currency} /></td>
                        <td className="py-2 text-right"><Money value={b.difference} currency={p.currency} tone="auto" signed /> <span className="text-xs text-muted">{b.difference >= 0 ? "under" : "over"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="cashflow">
          <Card>
            <CardHeader title="Daily cash flow" description="Income and spending by day (transfers excluded)" />
            <CardBody>
              {p.daily ? (
                <DailyChart data={p.daily} currency={p.currency} />
              ) : (
                <p className="py-8 text-center text-sm text-muted">Choose a range of 120 days or less to see daily detail.</p>
              )}
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="forecast" className="space-y-4">
          <div className="no-print flex gap-1.5">
            {[7, 30, 90].map((d) => (
              <Button key={d} size="sm" variant={p.horizon === d ? "primary" : "secondary"} onClick={() => nav({ days: String(d), tab: "forecast" })}>{d} days</Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["optimistic", "expected", "conservative"] as const).map((k) => (
              <Card key={k} className={cn("p-4", k === "expected" && "border-accent/50")}>
                <p className="text-[13px] capitalize text-muted">{k} in {p.horizon} days</p>
                <p className="mt-1 text-2xl font-semibold"><Money value={p.forecast.points.at(-1)?.[k] ?? p.forecast.startBalance} currency={p.currency} tone="negative" /></p>
                <p className="text-xs text-muted">{k === "expected" ? "Typical everyday spending" : k === "optimistic" ? "Quieter weeks" : "Busier weeks"}</p>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader title="Spendable balance forecast" description={`Starting from ${formatMoney(p.forecast.startBalance, p.currency)} today`} />
            <CardBody>
              <ForecastChart points={p.forecast.points} currency={p.currency} threshold={p.threshold} start={{ date: p.today, balance: p.forecast.startBalance }} height={300} />
              {p.forecast.shortfall && (
                <Alert tone="warning" className="mt-4">
                  In the {p.forecast.shortfall.scenario} scenario your balance drops below your threshold around {formatDisplayDate(p.forecast.shortfall.date, { weekday: true })}.
                </Alert>
              )}
              {p.cardPayments.length > 0 && (
                <p className="mt-3 text-xs text-muted">
                  Includes card payments: {p.cardPayments.map((c) => `${c.account} ${formatMoney(-c.amount, p.currency)} on ${formatDisplayDate(c.date)}${c.estimatedDate ? " (estimated date)" : ""}`).join("; ")}.
                </p>
              )}
              <h3 className="mt-5 text-sm font-semibold">Assumptions</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted">
                {p.forecast.assumptions.map((a) => <li key={a}>{a}</li>)}
                <li>Everyday spending estimate: {formatMoney(p.forecast.variable.dailyExpected, p.currency)}/day expected (range {formatMoney(p.forecast.variable.dailyOptimistic, p.currency)}–{formatMoney(p.forecast.variable.dailyConservative, p.currency)}).</li>
              </ul>
            </CardBody>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Metric({ label, value, prev, currency, inverse }: { label: string; value: number; prev: number; currency: string; inverse?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold"><Money value={value} currency={currency} tone={label === "Net" ? "negative" : "none"} /></p>
      <p className="mt-0.5 flex items-center gap-2 text-xs text-muted">
        <Delta value={value - prev} currency={currency} inverse={inverse} /> vs <Money value={prev} currency={currency} />
      </p>
    </Card>
  );
}

function Definitions() {
  return (
    <Card>
      <CardHeader title="How these figures are defined" />
      <CardBody>
        <dl className="grid gap-x-8 gap-y-3 text-[13px] md:grid-cols-2">
          {DEFINITIONS.map(([t, d]) => (
            <div key={t}>
              <dt className="font-medium">{t}</dt>
              <dd className="text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

function SingleBars({ data, currency, name }: { data: { label: string; value: number }[]; currency: string; name: string }) {
  return (
    <ChartFrame label={`${name} by month`} table={{ headers: ["Month", name], rows: data.map((d) => [d.label, formatMoney(d.value, currency)]) }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(m: string) => shortMonth(m)} />
          <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={compactDollars} />
          <RTooltip cursor={{ fill: "var(--surface-2)" }} content={({ active, payload }) => (active && payload?.length ? <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop"><p className="text-muted">{formatMonthKey(payload[0].payload.label)}</p><p className="num font-semibold">{formatMoney(payload[0].payload.value, currency)}</p></div> : null)} />
          <Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function DailyChart({ data, currency }: { data: DailyPoint[]; currency: string }) {
  return (
    <ChartFrame
      label="Daily income and spending"
      height={260}
      legend={<Legend items={[{ label: "Income", color: "var(--chart-1)" }, { label: "Spending", color: "var(--chart-2)" }]} />}
      table={{ headers: ["Date", "Income", "Spending", "Net"], rows: data.map((d) => [d.date, formatMoney(d.income, currency), formatMoney(d.spending, currency), formatMoney(d.net, currency)]) }}
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={1}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} tickFormatter={(d: string) => formatDisplayDate(d)} />
          <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={compactDollars} />
          <RTooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
                  <p className="mb-1 text-muted">{formatDisplayDate(payload[0].payload.date, { weekday: true })}</p>
                  <p className="flex justify-between gap-4"><span className="text-muted">Income</span><span className="num font-semibold">{formatMoney(payload[0].payload.income, currency)}</span></p>
                  <p className="flex justify-between gap-4"><span className="text-muted">Spending</span><span className="num font-semibold">{formatMoney(payload[0].payload.spending, currency)}</span></p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="income" fill="var(--chart-1)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="spending" fill="var(--chart-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
