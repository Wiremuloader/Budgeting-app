"use client";

import * as React from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/domain/money";
import { formatDisplayDate, shortMonth } from "@/domain/dates";
import { cn } from "@/lib/utils";

/*
 * Chart conventions (see the dataviz guidance this project follows):
 *  - one y-axis, recessive grid, thin marks, 4px rounded bar ends, 2px lines
 *  - hover tooltip with values first; legend for ≥2 series
 *  - money arrives in cents; axes show compact dollars, tooltips show exact amounts
 *  - every chart has a "View as table" alternative
 */

const AXIS = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;

export function compactDollars(cents: number): string {
  const d = cents / 100; // display-only scaling for axis ticks
  const abs = Math.abs(d);
  const sign = d < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}m`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1000)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

interface TipRow {
  label: string;
  value: number;
  color: string;
  dashed?: boolean;
}

function TooltipCard({ title, rows, currency, footer }: { title: string; rows: TipRow[]; currency: string; footer?: React.ReactNode }) {
  return (
    <div className="min-w-44 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1.5 font-medium text-muted">{title}</p>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: r.color, ...(r.dashed ? { background: `repeating-linear-gradient(90deg, ${r.color} 0 3px, transparent 3px 5px)` } : {}) }} aria-hidden />
            <span className="num ml-auto order-2 font-semibold text-text">{formatMoney(r.value, currency)}</span>
            <span className="text-muted">{r.label}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t border-border pt-1.5 text-muted">{footer}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; kind?: "rect" | "line" | "dashed" }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.kind === "rect" || !i.kind ? (
            <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden />
          ) : (
            <span className="h-0.5 w-3.5 rounded" style={i.kind === "dashed" ? { background: `repeating-linear-gradient(90deg, ${i.color} 0 3px, transparent 3px 5px)` } : { background: i.color }} aria-hidden />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Toggle between the chart and an accessible data table. */
export function ChartFrame({
  children,
  table,
  legend,
  height = 240,
  label,
  empty,
}: {
  children: React.ReactNode;
  table: { headers: string[]; rows: (string | number)[][] };
  legend?: React.ReactNode;
  height?: number;
  label: string;
  empty?: React.ReactNode;
}) {
  const [asTable, setAsTable] = React.useState(false);
  if (empty) return <div style={{ minHeight: height }} className="grid place-items-center text-center text-sm text-muted">{empty}</div>;
  return (
    <figure aria-label={label}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>{legend}</div>
        <button type="button" className="no-print shrink-0 text-xs text-muted underline-offset-2 hover:text-text hover:underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "View chart" : "View as table"}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-80 overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-surface-2 text-muted">
              <tr>
                {table.headers.map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((c, j) => (
                    <td key={j} className={cn("px-3 py-1.5", j > 0 && "num text-right")}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }} className="w-full" aria-hidden>
          {children}
        </div>
      )}
    </figure>
  );
}

/* ------------------------------------------------- income vs spending bars */

export function IncomeSpendingChart({ data, currency }: { data: { month: string; income: number; spending: number; net: number }[]; currency: string }) {
  const empty = data.every((d) => d.income === 0 && d.spending === 0);
  return (
    <ChartFrame
      label="Income and spending by month"
      legend={<Legend items={[{ label: "Income", color: "var(--chart-1)" }, { label: "Spending", color: "var(--chart-2)" }]} />}
      table={{ headers: ["Month", "Income", "Spending", "Net"], rows: data.map((d) => [d.month, formatMoney(d.income, currency), formatMoney(d.spending, currency), formatMoney(d.net, currency)]) }}
      empty={empty ? "No income or spending recorded in this period yet." : undefined}
    >
      <ResponsiveContainer>
        <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" {...AXIS} tickFormatter={(m: string) => shortMonth(m)} />
          <YAxis {...AXIS} width={48} tickFormatter={compactDollars} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TooltipCard
                  title={shortMonth(payload[0].payload.month) + " " + payload[0].payload.month.slice(0, 4)}
                  currency={currency}
                  rows={[
                    { label: "Income", value: payload[0].payload.income, color: "var(--chart-1)" },
                    { label: "Spending", value: payload[0].payload.spending, color: "var(--chart-2)" },
                  ]}
                  footer={<>Net <span className="num font-medium text-text">{formatMoney(payload[0].payload.net, currency, { signed: true })}</span></>}
                />
              ) : null
            }
          />
          <Bar dataKey="income" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="spending" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* --------------------------------------------------------- net worth line */

export function NetWorthChart({ data, currency, height = 220 }: { data: { month: string; netWorth: number; assets: number; liabilities: number }[]; currency: string; height?: number }) {
  return (
    <ChartFrame
      label="Net worth by month"
      height={height}
      table={{ headers: ["Month", "Assets", "Liabilities", "Net worth"], rows: data.map((d) => [d.month, formatMoney(d.assets, currency), formatMoney(d.liabilities, currency), formatMoney(d.netWorth, currency)]) }}
      empty={data.length === 0 ? "Add accounts to see your net worth over time." : undefined}
    >
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" {...AXIS} tickFormatter={(m: string) => shortMonth(m)} />
          <YAxis {...AXIS} width={52} tickFormatter={compactDollars} domain={["auto", "auto"]} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TooltipCard
                  title={`End of ${shortMonth(payload[0].payload.month)} ${payload[0].payload.month.slice(0, 4)}`}
                  currency={currency}
                  rows={[
                    { label: "Net worth", value: payload[0].payload.netWorth, color: "var(--chart-1)" },
                    { label: "Assets", value: payload[0].payload.assets, color: "var(--muted)" },
                    { label: "Liabilities", value: payload[0].payload.liabilities, color: "var(--muted)" },
                  ]}
                />
              ) : null
            }
          />
          <Area type="monotone" dataKey="netWorth" stroke="var(--chart-1)" strokeWidth={2} fill="url(#nw-fill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ----------------------------------------------------------- forecast band */

export function ForecastChart({
  points,
  currency,
  threshold,
  start,
  height = 240,
}: {
  points: { date: string; optimistic: number; expected: number; conservative: number; events: { label: string; amount: number }[] }[];
  currency: string;
  threshold: number;
  start: { date: string; balance: number };
  height?: number;
}) {
  const data = [{ date: start.date, optimistic: start.balance, expected: start.balance, conservative: start.balance, events: [] }, ...points].map((p) => ({
    ...p,
    band: [p.conservative, p.optimistic] as [number, number],
  }));
  return (
    <ChartFrame
      label="Cash-flow forecast"
      height={height}
      legend={
        <Legend
          items={[
            { label: "Expected", color: "var(--chart-1)", kind: "line" },
            { label: "Conservative – optimistic range", color: "color-mix(in oklab, var(--chart-1) 25%, transparent)" },
            ...(threshold > 0 ? [{ label: "Your low-balance threshold", color: "var(--warning)", kind: "dashed" as const }] : []),
          ]}
        />
      }
      table={{ headers: ["Date", "Conservative", "Expected", "Optimistic", "Scheduled"], rows: points.map((p) => [p.date, formatMoney(p.conservative, currency), formatMoney(p.expected, currency), formatMoney(p.optimistic, currency), p.events.map((e) => `${e.label} ${formatMoney(e.amount, currency, { signed: true })}`).join("; ")]) }}
    >
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" {...AXIS} minTickGap={28} tickFormatter={(d: string) => formatDisplayDate(d)} />
          <YAxis {...AXIS} width={52} tickFormatter={compactDollars} />
          {threshold > 0 && <ReferenceLine y={threshold} stroke="var(--warning)" strokeDasharray="4 3" strokeWidth={1.5} />}
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof data)[number];
              return (
                <TooltipCard
                  title={formatDisplayDate(p.date, { weekday: true })}
                  currency={currency}
                  rows={[
                    { label: "Expected", value: p.expected, color: "var(--chart-1)" },
                    { label: "Conservative", value: p.conservative, color: "var(--muted)" },
                    { label: "Optimistic", value: p.optimistic, color: "var(--muted)" },
                  ]}
                  footer={
                    p.events.length ? (
                      <ul className="space-y-0.5">
                        {p.events.map((e, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span>{e.label}</span>
                            <span className="num">{formatMoney(e.amount, currency, { signed: true })}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "Estimate — not guaranteed"
                    )
                  }
                />
              );
            }}
          />
          <Area type="monotone" dataKey="band" stroke="none" fill="var(--chart-1)" fillOpacity={0.14} isAnimationActive={false} />
          <Line type="monotone" dataKey="expected" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* ------------------------------------------- cumulative spend vs last month */

export function CumulativeSpendChart({
  current,
  previous,
  currency,
  budget,
  height = 200,
}: {
  current: { date: string; cumulativeSpending: number }[];
  previous: { date: string; cumulativeSpending: number }[];
  currency: string;
  budget?: number;
  height?: number;
}) {
  const days = Math.max(previous.length, current.length);
  const data = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    thisMonth: current[i]?.cumulativeSpending ?? null,
    lastMonth: previous[i]?.cumulativeSpending ?? null,
  }));
  return (
    <ChartFrame
      label="Spending so far this month compared with last month"
      height={height}
      legend={
        <Legend
          items={[
            { label: "This month", color: "var(--chart-1)", kind: "line" },
            { label: "Last month", color: "var(--chart-other)", kind: "dashed" },
          ]}
        />
      }
      table={{ headers: ["Day", "This month", "Last month"], rows: data.map((d) => [d.day, d.thisMonth === null ? "—" : formatMoney(d.thisMonth, currency), d.lastMonth === null ? "—" : formatMoney(d.lastMonth, currency)]) }}
    >
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="day" {...AXIS} interval="preserveStartEnd" minTickGap={20} />
          <YAxis {...AXIS} width={48} tickFormatter={compactDollars} />
          {budget ? <ReferenceLine y={budget} stroke="var(--border-strong)" strokeDasharray="4 3" label={{ value: "Budget", position: "insideTopRight", fill: "var(--muted)", fontSize: 11 }} /> : null}
          <Tooltip
            cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof data)[number];
              const rows: TipRow[] = [];
              if (p.thisMonth !== null) rows.push({ label: "This month", value: p.thisMonth, color: "var(--chart-1)" });
              if (p.lastMonth !== null) rows.push({ label: "Last month", value: p.lastMonth, color: "var(--chart-other)", dashed: true });
              return <TooltipCard title={`Day ${p.day}`} currency={currency} rows={rows} />;
            }}
          />
          <Line type="monotone" dataKey="lastMonth" stroke="var(--chart-other)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="thisMonth" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* --------------------------------------------- ranked horizontal bars (HTML) */

/**
 * Ranked bars for one measure (spending by category/merchant). Built in HTML so
 * every value is a visible label (no color-only encoding) and it reflows on mobile.
 */
export function RankedBars({
  rows,
  currency,
  max: maxRows = 8,
  hrefTemplate,
  compareLabel = "previous period",
}: {
  rows: { key: string; label: string; value: number; previous?: number; share?: number | null }[];
  currency: string;
  max?: number;
  /** Link template; "{key}" is replaced with the row key. */
  hrefTemplate?: string;
  compareLabel?: string;
}) {
  const visible = rows.filter((r) => r.value > 0).slice(0, maxRows);
  const rest = rows.filter((r) => r.value > 0).slice(maxRows);
  const restTotal = rest.reduce((a, r) => a + r.value, 0);
  const top = Math.max(...visible.map((r) => r.value), restTotal, 1);
  const all = restTotal > 0 ? [...visible, { key: "__other", label: `Other (${rest.length})`, value: restTotal }] : visible;
  if (!all.length) return <p className="py-8 text-center text-sm text-muted">No spending in this period.</p>;
  return (
    <ul className="space-y-2.5">
      {all.map((r) => {
        const href = r.key !== "__other" && hrefTemplate ? hrefTemplate.replace("{key}", encodeURIComponent(r.key)) : null;
        const label = href ? (
          <a href={href} className="truncate hover:underline">
            {r.label}
          </a>
        ) : (
          <span className="truncate">{r.label}</span>
        );
        const prev = "previous" in r ? r.previous : undefined;
        return (
          <li key={r.key} className="group">
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              {label}
              <span className="flex shrink-0 items-baseline gap-2">
                {prev !== undefined && prev > 0 && (
                  <span className={cn("num text-[11px]", r.value > prev ? "text-negative" : "text-positive")} title={`Compared with ${compareLabel}: ${formatMoney(prev, currency)}`}>
                    {r.value > prev ? "▲" : "▼"} {Math.abs(Math.round(((r.value - prev) / prev) * 100))}%
                  </span>
                )}
                <span className="num font-medium">{formatMoney(r.value, currency, { compact: r.value >= 100_00 })}</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-[var(--chart-1)] transition-[width] duration-500 group-hover:opacity-80" style={{ width: `${(r.value / top) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------ budget bullet (HTML) */

export function BudgetBar({ spent, budgeted, projected, label }: { spent: number; budgeted: number; projected?: number | null; label: string }) {
  const scale = Math.max(budgeted, spent, projected ?? 0, 1);
  const over = spent > budgeted && budgeted > 0;
  const near = !over && budgeted > 0 && spent / budgeted >= 0.85;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2" role="img" aria-label={label}>
      {projected != null && projected > spent && (
        <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--chart-1)] opacity-20" style={{ width: `${Math.min((projected / scale) * 100, 100)}%` }} />
      )}
      <div className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-negative" : near ? "bg-warning" : "bg-[var(--chart-1)]")} style={{ width: `${Math.min((spent / scale) * 100, 100)}%` }} />
      {budgeted > 0 && budgeted < scale && <div className="absolute inset-y-0 w-0.5 bg-text/60" style={{ left: `calc(${(budgeted / scale) * 100}% - 1px)` }} aria-hidden />}
    </div>
  );
}
