"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Landmark, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Money, MoneyInput } from "@/components/money";
import { ChartFrame, Legend, compactDollars } from "@/components/charts";
import { useQuickAdd } from "@/components/transactions/quick-add";
import { createDebtAction, deleteDebtAction, updateDebtAction } from "@/server/actions/finance";
import type { DebtView as DebtRow } from "@/server/services/debts";
import { compareStrategies, DEBT_ASSUMPTIONS, type PayoffResult } from "@/domain/debt";
import { addMonths, formatDisplayDate } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";

type Debt = Omit<DebtRow, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

const KIND_LABEL: Record<Debt["kind"], string> = {
  credit_card: "Credit card",
  personal_loan: "Personal loan",
  student_loan: "Student loan",
  vehicle: "Vehicle finance",
  mortgage: "Mortgage",
  other: "Other",
};

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export function DebtView({ debts, unlinked, today, currency }: { debts: Debt[]; unlinked: { id: string; name: string; balance: number }[]; today: string; currency: string }) {
  const router = useRouter();
  const { open } = useQuickAdd();
  const [extra, setExtra] = React.useState<number | null>(10_000);
  const [editing, setEditing] = React.useState<Debt | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<Debt | null>(null);
  const owing = debts.filter((d) => d.balance > 0);
  const total = owing.reduce((a, d) => a + d.balance, 0);
  const minimums = owing.reduce((a, d) => a + d.minimumPayment, 0);
  const plan = React.useMemo(
    () => compareStrategies(owing.map((d) => ({ id: d.id, name: d.accountName, balance: d.balance, aprBps: d.aprBps, minimumPayment: d.minimumPayment, rateChanges: d.rateChanges })), extra ?? 0),
    [owing, extra],
  );
  const best = plan.avalanche.totalInterest <= plan.snowball.totalInterest ? "avalanche" : "snowball";
  const payoffDate = (r: PayoffResult) => (r.months === null ? "Not within 50 years" : formatDisplayDate(addMonths(today, r.months), { year: true }));

  return (
    <>
      <PageHeader
        title="Debt"
        description="See what you owe, what it costs, and how extra payments change the timeline."
        actions={
          <>
            <Button size="sm" onClick={() => open()}>Record a payment</Button>
            <Button size="sm" variant="primary" onClick={() => setEditing("new")}><Plus /> Add debt</Button>
          </>
        }
      />

      {debts.length === 0 ? (
        <Card>
          <EmptyState icon={<Landmark />} title="No debts recorded" action={<Button variant="primary" onClick={() => setEditing("new")}>Add a debt</Button>}>
            Add credit cards, loans, vehicle finance or a student loan to plan repayments.
          </EmptyState>
        </Card>
      ) : (
        <>
          <section className="mb-5 grid gap-3 sm:grid-cols-3">
            <Card className="p-4"><p className="text-[13px] text-muted">Total owed</p><p className="mt-1 text-2xl font-semibold"><Money value={total} currency={currency} /></p></Card>
            <Card className="p-4"><p className="text-[13px] text-muted">Minimum payments / month</p><p className="mt-1 text-2xl font-semibold"><Money value={minimums} currency={currency} /></p></Card>
            <Card className="p-4">
              <p className="text-[13px] text-muted">Debt-free (with extra {formatMoney(extra ?? 0, currency, { compact: true })}/mo)</p>
              <p className="mt-1 text-2xl font-semibold">{payoffDate(plan[best])}</p>
              <p className="text-[11px] text-muted">Estimate</p>
            </Card>
          </section>

          <Card className="mb-5">
            <ul className="divide-y divide-border">
              {debts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {d.accountName}
                      <Badge>{KIND_LABEL[d.kind]}</Badge>
                      {d.balance === 0 && <Badge tone="positive">Paid off</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {d.lender ? `${d.lender} · ` : ""}
                      {d.aprBps === 0 ? "Interest-free" : `${pct(d.aprBps)} a year`}
                      {d.aprIsEstimate && " (your estimate)"}
                      {d.nextDueDate ? ` · next due ${formatDisplayDate(d.nextDueDate, { weekday: true })}` : ""}
                      {d.paidLast90Days > 0 ? ` · paid ${formatMoney(d.paidLast90Days, currency)} in the last 3 months` : ""}
                    </p>
                    {d.confirmedBalance !== null && d.confirmedBalanceDate && (
                      <p className="mt-0.5 text-xs text-muted">
                        Lender confirmed {formatMoney(d.confirmedBalance, currency)} on {formatDisplayDate(d.confirmedBalanceDate, { year: true })}
                        {d.confirmedBalance !== d.balance && <span className="text-warning"> — differs from Ledger’s balance by {formatMoney(Math.abs(d.confirmedBalance - d.balance), currency)}</span>}
                      </p>
                    )}
                    {d.notes && <p className="mt-1 text-xs text-text-2">{d.notes}</p>}
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-lg font-semibold"><Money value={d.balance} currency={currency} /></p>
                    <p className="text-xs text-muted">min {formatMoney(d.minimumPayment, currency)}/mo</p>
                  </div>
                  <Menu>
                    <MenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.accountName}`}><MoreHorizontal /></Button></MenuTrigger>
                    <MenuContent>
                      <MenuItem icon={<Pencil />} onSelect={() => setEditing(d)}>Edit details</MenuItem>
                      <MenuItem onSelect={() => router.push(`/transactions?account=${d.accountId}`)}>View payments</MenuItem>
                      <MenuSeparator />
                      <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(d)}>Remove debt details</MenuItem>
                    </MenuContent>
                  </Menu>
                </li>
              ))}
            </ul>
          </Card>

          {owing.length > 0 && (
            <Card>
              <CardHeader title="Payoff planner" description="Compare paying the highest rate first (avalanche) with the smallest balance first (snowball)." />
              <CardBody>
                <div className="mb-5 flex flex-wrap items-end gap-4">
                  <Field label="Extra each month, on top of minimums" htmlFor="extra" className="w-56">
                    <MoneyInput id="extra" value={extra} currency={currency} onChange={(v) => setExtra(v ?? 0)} />
                  </Field>
                  <div className="flex gap-1.5">
                    {[0, 5_000, 10_000, 25_000, 50_000].map((v) => (
                      <Button key={v} size="sm" variant={extra === v ? "primary" : "secondary"} onClick={() => setExtra(v)}>
                        +{formatMoney(v, currency, { compact: true })}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted">
                      <tr className="border-b border-border">
                        <th className="py-2 pr-4 font-medium">Strategy</th>
                        <th className="py-2 pr-4 font-medium">Monthly payment</th>
                        <th className="py-2 pr-4 font-medium">Debt-free</th>
                        <th className="py-2 pr-4 font-medium">Months</th>
                        <th className="py-2 font-medium">Total interest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([["minimum", "Minimum payments only"], ["avalanche", "Avalanche — highest rate first"], ["snowball", "Snowball — smallest balance first"]] as const).map(([k, label]) => {
                        const r = plan[k];
                        return (
                          <tr key={k} className={cn("border-b border-border last:border-0", k === best && "bg-accent-soft/40")}>
                            <td className="py-2.5 pr-4 font-medium">{label} {k === best && <Badge tone="accent">Least interest</Badge>}</td>
                            <td className="py-2.5 pr-4"><Money value={r.monthlyPayment} currency={currency} /></td>
                            <td className="py-2.5 pr-4">{payoffDate(r)}</td>
                            <td className="num py-2.5 pr-4">{r.months ?? "—"}</td>
                            <td className="py-2.5"><Money value={r.totalInterest} currency={currency} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {plan.interestSaved !== null && plan.interestSaved > 0 && (
                  <p className="mt-3 text-sm">
                    Paying an extra {formatMoney(extra ?? 0, currency)} a month with the {best} method saves about <strong>{formatMoney(plan.interestSaved, currency)}</strong> in interest compared with minimum payments.
                  </p>
                )}
                {[...new Set([...plan.minimum.warnings, ...plan.avalanche.warnings])].map((w) => (
                  <Alert key={w} tone="warning" className="mt-3">{w}</Alert>
                ))}

                <div className="mt-5">
                  <p className="mb-2 text-sm font-medium">Order of repayment ({best})</p>
                  <ol className="flex flex-wrap gap-2 text-[13px]">
                    {plan[best].debts.map((d, i) => (
                      <li key={d.id} className="rounded-full border border-border px-3 py-1">
                        {i + 1}. {d.name} {d.payoffMonth !== null && <span className="text-muted">· month {d.payoffMonth}</span>}
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="mt-6">
                  <PayoffChart plan={plan} currency={currency} />
                </div>

                <details className="mt-4 text-[13px] text-muted">
                  <summary className="cursor-pointer font-medium text-text-2">Assumptions behind these estimates</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {DEBT_ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}
                    <li>Balances come from your recorded transactions, not your lender. Check your lender’s statement for exact figures.</li>
                    <li>NZ student loans are interest-free while you live in New Zealand; overseas-based borrowers are charged interest. Enter the rate that applies to you.</li>
                  </ul>
                </details>
              </CardBody>
            </Card>
          )}
        </>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent title={editing === "new" ? "Add a debt" : `Edit ${editing.accountName}`}>
            <DebtForm debt={editing === "new" ? null : editing} unlinked={unlinked} today={today} currency={currency} onDone={() => setEditing(null)} />
          </DialogContent>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove debt details?"
        description="The interest rate and payment details are removed. The account and its transactions stay (archive the account separately if you no longer need it)."
        confirmLabel="Remove"
        danger
        onConfirm={async () => {
          const r = await deleteDebtAction({ id: deleting!.id });
          setDeleting(null);
          if (!r.ok) return toast.error(r.error);
          router.refresh();
        }}
      />
    </>
  );
}

function PayoffChart({ plan, currency }: { plan: ReturnType<typeof compareStrategies>; currency: string }) {
  const len = Math.min(Math.max(plan.minimum.balanceByMonth.length, plan.avalanche.balanceByMonth.length, plan.snowball.balanceByMonth.length), 360);
  const data = Array.from({ length: len }, (_, i) => ({
    month: i + 1,
    minimum: plan.minimum.balanceByMonth[i] ?? 0,
    avalanche: plan.avalanche.balanceByMonth[i] ?? 0,
    snowball: plan.snowball.balanceByMonth[i] ?? 0,
  }));
  const series = [
    { key: "minimum", label: "Minimums only", color: "var(--chart-other)", dash: "4 3" },
    { key: "avalanche", label: "Avalanche", color: "var(--chart-1)" },
    { key: "snowball", label: "Snowball", color: "var(--chart-2)" },
  ] as const;
  return (
    <ChartFrame
      label="Total debt remaining by month"
      height={240}
      legend={<Legend items={series.map((s) => ({ label: s.label, color: s.color, kind: "dash" in s ? "dashed" : "line" }))} />}
      table={{ headers: ["Month", "Minimums only", "Avalanche", "Snowball"], rows: data.filter((_, i) => i % 3 === 0).map((d) => [d.month, formatMoney(d.minimum, currency), formatMoney(d.avalanche, currency), formatMoney(d.snowball, currency)]) }}
    >
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="month" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(m: number) => (m % 12 === 0 ? `${m / 12}y` : "")} interval={0} />
          <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} width={52} tickFormatter={compactDollars} />
          <RTooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
                  <p className="mb-1 text-muted">Month {payload[0].payload.month}</p>
                  {series.map((s) => (
                    <p key={s.key} className="flex justify-between gap-4">
                      <span className="text-muted">{s.label}</span>
                      <span className="num font-semibold">{formatMoney(payload[0].payload[s.key], currency)}</span>
                    </p>
                  ))}
                </div>
              ) : null
            }
          />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} strokeDasharray={"dash" in s ? s.dash : undefined} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function DebtForm({ debt, unlinked, today, currency, onDone }: { debt: Debt | null; unlinked: { id: string; name: string; balance: number }[]; today: string; currency: string; onDone: () => void }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"new" | "existing">(unlinked.length && !debt ? "existing" : "new");
  const [accountId, setAccountId] = React.useState(unlinked[0]?.id ?? "");
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<Debt["kind"]>(debt?.kind ?? "credit_card");
  const [lender, setLender] = React.useState(debt?.lender ?? "");
  const [balance, setBalance] = React.useState<number | null>(null);
  const [rate, setRate] = React.useState(debt ? (debt.aprBps / 100).toFixed(2) : "");
  const [estimate, setEstimate] = React.useState(debt?.aprIsEstimate ?? true);
  const [minimum, setMinimum] = React.useState<number | null>(debt?.minimumPayment ?? null);
  const [dueDay, setDueDay] = React.useState(debt?.dueDay?.toString() ?? "");
  const [confirmed, setConfirmed] = React.useState<number | null>(debt?.confirmedBalance ?? null);
  const [confirmedDate, setConfirmedDate] = React.useState(debt?.confirmedBalanceDate ?? today);
  const [notes, setNotes] = React.useState(debt?.notes ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  function parseRate(): number | null {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(rate.trim())) return null;
    const [w, f = ""] = rate.trim().split(".");
    return Number(w) * 100 + Number(f.padEnd(2, "0"));
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const aprBps = parseRate();
        if (aprBps === null) return setError("Enter the interest rate as a percentage, e.g. 19.95 (use 0 for interest-free)");
        setSaving(true);
        const common = { kind, lender: lender || null, aprBps, aprIsEstimate: estimate, minimumPayment: minimum ?? 0, dueDay: dueDay ? Number(dueDay) : null, notes: notes || null };
        const r = debt
          ? await updateDebtAction({ id: debt.id, ...common, confirmedBalance: confirmed, confirmedBalanceDate: confirmed !== null ? confirmedDate : null })
          : await createDebtAction({ ...common, name: mode === "existing" ? "" + (unlinked.find((u) => u.id === accountId)?.name ?? "Debt") : name, balanceOwed: balance ?? 0, asOf: today, accountId: mode === "existing" ? accountId : null });
        setSaving(false);
        if (!r.ok) return setError(r.error);
        toast.success(debt ? "Saved" : "Debt added");
        router.refresh();
        onDone();
      }}
    >
      {error && <Alert tone="negative">{error}</Alert>}
      {!debt && unlinked.length > 0 && (
        <div role="radiogroup" aria-label="Debt source" className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5 text-sm">
          {(["existing", "new"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn("h-8 flex-1 rounded-md font-medium", mode === m ? "bg-surface shadow-card" : "text-muted")}>
              {m === "existing" ? "An account I already track" : "A new debt"}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {!debt && mode === "existing" ? (
          <Field label="Account" htmlFor="d-acc" className="sm:col-span-2">
            <Select id="d-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {unlinked.map((u) => <option key={u.id} value={u.id}>{u.name} ({formatMoney(Math.max(-u.balance, 0), currency)} owed)</option>)}
            </Select>
          </Field>
        ) : !debt ? (
          <>
            <Field label="Name" htmlFor="d-name"><Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Car loan" maxLength={60} /></Field>
            <Field label="Amount owed today" htmlFor="d-bal"><MoneyInput id="d-bal" value={balance} currency={currency} onChange={(v) => setBalance(v)} /></Field>
          </>
        ) : null}
        <Field label="Type" htmlFor="d-kind">
          <Select id="d-kind" value={kind} onChange={(e) => { setKind(e.target.value as Debt["kind"]); if (e.target.value === "student_loan" && !rate) setRate("0"); }}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Lender" htmlFor="d-lender" optional><Input id="d-lender" value={lender} onChange={(e) => setLender(e.target.value)} maxLength={80} /></Field>
        <Field label="Interest rate (% a year)" htmlFor="d-rate" hint={kind === "student_loan" ? "NZ student loans are usually 0% while you live in NZ." : undefined}>
          <Input id="d-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 19.95" />
        </Field>
        <Field label="Minimum monthly payment" htmlFor="d-min"><MoneyInput id="d-min" value={minimum} currency={currency} onChange={(v) => setMinimum(v)} /></Field>
        <Field label="Due day of month" htmlFor="d-due" optional><Input id="d-due" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} /></Field>
        {debt && (
          <>
            <Field label="Lender-confirmed balance" htmlFor="d-conf" optional hint="From a statement. Shown next to Ledger’s calculated balance.">
              <MoneyInput id="d-conf" value={confirmed} currency={currency} onChange={(v) => setConfirmed(v)} />
            </Field>
            <Field label="Statement date" htmlFor="d-confd"><Input id="d-confd" type="date" max={today} value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} /></Field>
          </>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={estimate} onChange={(e) => setEstimate(e.target.checked)} /> The rate is my estimate (not confirmed by the lender)</label>
      <Field label="Notes" htmlFor="d-notes" optional><Textarea id="d-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></Field>
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>{debt ? "Save" : "Add debt"}</Button>
      </DialogFooter>
    </form>
  );
}
