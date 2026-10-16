"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Check, CircleAlert, CircleCheck, Clock, MoreHorizontal, Pause, Pencil, Play, Plus, Repeat, Sparkles, Trash2, TrendingUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, Select } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { Money, MoneyInput } from "@/components/money";
import { useQuickAdd } from "@/components/transactions/quick-add";
import { CategoryOptions } from "@/components/transactions/transaction-form";
import { confirmSuggestionAction, createRuleAction, deleteRuleAction, dismissSuggestionAction, setRuleStatusAction, updateRuleAction } from "@/server/actions/finance";
import type { Occurrence, RuleSummary, Suggestion } from "@/server/services/recurring";
import { diffDays, formatDisplayDate } from "@/domain/dates";
import { formatMoney } from "@/domain/money";

type Rule = Omit<RuleSummary, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

const KIND_LABEL: Record<Rule["kind"], string> = { income: "Income", bill: "Bill", subscription: "Subscription", transfer: "Transfer", debt_payment: "Debt payment" };

export function RecurringView({
  rules,
  upcoming,
  suggestions,
  commitments,
  today,
  currency,
  openNew,
  initialTab,
}: {
  rules: Rule[];
  upcoming: Occurrence[];
  suggestions: Suggestion[];
  commitments: { outflow: number; income: number; transfers: number; disposable: number };
  today: string;
  currency: string;
  openNew: "income" | "bill" | null;
  initialTab: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Rule | { kind: Rule["kind"] } | null>(openNew ? { kind: openNew } : null);
  const [deleting, setDeleting] = React.useState<Rule | null>(null);
  const [tab, setTab] = React.useState(initialTab);
  const subs = rules.filter((r) => r.kind === "subscription");
  const others = rules.filter((r) => r.kind !== "subscription");
  const due = upcoming.filter((o) => o.status === "late" || o.status === "missed");

  async function setStatus(r: Rule, status: "active" | "paused") {
    const res = await setRuleStatusAction({ id: r.id, status });
    if (!res.ok) return toast.error(res.error);
    toast.success(status === "paused" ? "Paused" : "Resumed");
    router.refresh();
  }

  const ruleMenu = (r: Rule) => (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.name}`}><MoreHorizontal /></Button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem icon={<Pencil />} onSelect={() => setEditing(r)}>Edit</MenuItem>
        {r.status === "active" ? <MenuItem icon={<Pause />} onSelect={() => setStatus(r, "paused")}>Pause</MenuItem> : <MenuItem icon={<Play />} onSelect={() => setStatus(r, "active")}>Resume</MenuItem>}
        <MenuSeparator />
        <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(r)}>Delete</MenuItem>
      </MenuContent>
    </Menu>
  );

  return (
    <>
      <PageHeader
        title="Recurring"
        description="Pay, bills and subscriptions on a schedule. A bill is only marked paid when a matching transaction appears."
        actions={
          <>
            <Button size="sm" onClick={() => setEditing({ kind: "income" })}><Plus /> Income</Button>
            <Button size="sm" variant="primary" onClick={() => setEditing({ kind: "bill" })}><Plus /> Bill or subscription</Button>
          </>
        }
      />

      <section className="mb-5 grid gap-3 sm:grid-cols-4" aria-label="Monthly commitments">
        <Card className="p-4"><p className="text-[13px] text-muted">Regular income / month</p><p className="mt-1 text-xl font-semibold"><Money value={commitments.income} currency={currency} /></p></Card>
        <Card className="p-4"><p className="text-[13px] text-muted">Bills & subscriptions / month</p><p className="mt-1 text-xl font-semibold"><Money value={commitments.outflow} currency={currency} /></p></Card>
        <Card className="p-4"><p className="text-[13px] text-muted">Scheduled savings moves / month</p><p className="mt-1 text-xl font-semibold"><Money value={commitments.transfers} currency={currency} /></p></Card>
        <Card className="p-4">
          <p className="text-[13px] text-muted">Left for everything else</p>
          <p className="mt-1 text-xl font-semibold"><Money value={commitments.disposable} currency={currency} tone="negative" /></p>
          <p className="text-[11px] text-muted">Monthly average estimate</p>
        </Card>
      </section>

      {due.length > 0 && (
        <Alert tone="warning" icon={<CircleAlert />} className="mb-4" title="Not matched to a transaction yet">
          {due.map((o) => `${o.name} (${formatDisplayDate(o.date)})`).join(", ")}. If they were paid, record or import the transaction — Ledger links it automatically when the payee and amount match.
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="upcoming">Calendar</TabsTrigger>
          <TabsTrigger value="rules">Bills & income ({others.length})</TabsTrigger>
          <TabsTrigger value="subscriptions">Subscriptions ({subs.length})</TabsTrigger>
          <TabsTrigger value="suggestions">
            Detected {suggestions.length > 0 && <Badge tone="accent">{suggestions.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming">
          <UpcomingList upcoming={upcoming} today={today} currency={currency} />
        </TabsContent>

        <TabsContent value="rules">
          <RuleList rules={others} currency={currency} empty="No bills or income yet." menu={ruleMenu} onAdd={() => setEditing({ kind: "bill" })} />
        </TabsContent>

        <TabsContent value="subscriptions">
          {subs.length > 0 && (
            <Card className="mb-4 p-4 text-sm">
              Your active subscriptions cost about <Money value={subs.filter((s) => s.status === "active").reduce((a, s) => a + s.annualCost, 0)} currency={currency} className="font-semibold" /> a year.
              <span className="text-muted"> Ledger can’t cancel subscriptions for you — use the provider’s website or app.</span>
            </Card>
          )}
          <RuleList rules={[...subs].sort((a, b) => b.annualCost - a.annualCost)} currency={currency} empty="No subscriptions confirmed yet. Check the Detected tab." menu={ruleMenu} onAdd={() => setEditing({ kind: "subscription" })} />
        </TabsContent>

        <TabsContent value="suggestions">
          <SuggestionList suggestions={suggestions} currency={currency} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent title={"id" in editing ? `Edit ${editing.name}` : editing.kind === "income" ? "Add regular income" : "Add a bill or subscription"}>
            <RuleForm rule={"id" in editing ? editing : null} kind={editing.kind} today={today} currency={currency} onDone={() => setEditing(null)} />
          </DialogContent>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="The schedule is removed. Transactions already recorded stay, but are no longer linked to it."
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          const r = await deleteRuleAction({ id: deleting!.id });
          setDeleting(null);
          if (!r.ok) return toast.error(r.error);
          toast.success("Deleted");
          router.refresh();
        }}
      />
    </>
  );
}

function UpcomingList({ upcoming, today, currency }: { upcoming: Occurrence[]; today: string; currency: string }) {
  const { open } = useQuickAdd();
  if (!upcoming.length) return <Card><EmptyState icon={<CalendarClock />} title="Nothing scheduled">Add your pay and bills to see what’s coming.</EmptyState></Card>;
  const groups = new Map<string, Occurrence[]>();
  for (const o of upcoming) groups.set(o.date, [...(groups.get(o.date) ?? []), o]);
  return (
    <Card className="divide-y divide-border">
      {[...groups.entries()].map(([date, list]) => {
        const d = diffDays(today, date);
        return (
          <div key={date} className={cn("flex gap-4 px-5 py-3", d < 0 && "bg-surface-2/40")}>
            <div className="w-24 shrink-0 pt-0.5 text-[13px]">
              <p className={cn("font-medium", d === 0 && "text-accent")}>{d === 0 ? "Today" : d === 1 ? "Tomorrow" : formatDisplayDate(date, { weekday: true })}</p>
              <p className="text-xs text-muted">{d < 0 ? `${-d} days ago` : d > 1 ? `in ${d} days` : ""}</p>
            </div>
            <ul className="flex-1 space-y-2">
              {list.map((o) => (
                <li key={o.ruleId} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="flex-1 font-medium">{o.name}</span>
                  {o.status === "paid" && <Badge tone="positive"><CircleCheck className="size-3" /> {o.amount > 0 ? "Received" : "Paid"}{o.actualAmount !== null && o.actualAmount !== o.amount ? ` ${formatMoney(Math.abs(o.actualAmount), currency)}` : ""}</Badge>}
                  {o.status === "upcoming" && <Badge tone="outline"><Clock className="size-3" /> Scheduled</Badge>}
                  {o.status === "due" && <Badge tone="info">Due today</Badge>}
                  {(o.status === "late" || o.status === "missed") && (
                    <>
                      <Badge tone="warning"><CircleAlert className="size-3" /> Not matched</Badge>
                      <Button size="sm" variant="ghost" onClick={() => open()}>Record it</Button>
                    </>
                  )}
                  <Money value={o.amount} currency={currency} signed tone={o.amount > 0 ? "auto" : "none"} className="w-24 text-right font-medium" />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Card>
  );
}

function RuleList({ rules, currency, empty, menu, onAdd }: { rules: Rule[]; currency: string; empty: string; menu: (r: Rule) => React.ReactNode; onAdd: () => void }) {
  if (!rules.length) return <Card><EmptyState icon={<Repeat />} title={empty} action={<Button onClick={onAdd}><Plus /> Add</Button>} /></Card>;
  return (
    <Card>
      <ul className="divide-y divide-border">
        {rules.map((r) => (
          <li key={r.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5", r.status !== "active" && "opacity-60")}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {r.name}
                <Badge tone={r.kind === "income" ? "positive" : "neutral"}>{KIND_LABEL[r.kind]}</Badge>
                {r.status === "paused" && <Badge tone="outline">Paused</Badge>}
                {r.amountChanged && <Badge tone="warning"><TrendingUp className="size-3" /> Price changed</Badge>}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {r.schedule} · {r.accountName}
                {r.toAccountName ? ` → ${r.toAccountName}` : ""}
                {r.categoryName ? ` · ${r.categoryName}` : ""}
                {r.next ? ` · next ${formatDisplayDate(r.next, { weekday: true })}` : ""}
                {r.lastMatched ? ` · last ${formatMoney(Math.abs(r.lastMatched.amount), currency)} on ${formatDisplayDate(r.lastMatched.date)}` : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold"><Money value={Math.abs(r.amount)} currency={currency} />{r.amountVaries && <span className="text-xs font-normal text-muted"> approx.</span>}</p>
              <p className="text-[11px] text-muted">{formatMoney(r.annualCost, currency, { compact: true })} / year</p>
            </div>
            {menu(r)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SuggestionList({ suggestions, currency }: { suggestions: Suggestion[]; currency: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!suggestions.length) {
    return <Card><EmptyState icon={<Sparkles />} title="Nothing new detected">Ledger looks for payments that repeat on a regular schedule with a similar amount. Detected patterns appear here for you to confirm.</EmptyState></Card>;
  }
  return (
    <Card>
      <CardHeader title="Possible recurring payments" description="Found in your transaction history. Nothing is added until you confirm it." />
      <CardBody>
        <ul className="divide-y divide-border">
          {suggestions.map((s) => (
            <li key={s.merchantKey} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {s.merchantName}
                  <Badge tone={s.confidence === "high" ? "accent" : "neutral"}>{s.confidence === "high" ? "Strong pattern" : "Likely"}</Badge>
                  {s.duplicateOf && <Badge tone="warning">Similar to “{s.duplicateOf}”</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {s.frequency} · {s.occurrences} payments · last {formatDisplayDate(s.lastDate)} · {s.accountName}
                  {s.priceChange && ` · changed from ${formatMoney(Math.abs(s.priceChange.from), currency)} to ${formatMoney(Math.abs(s.priceChange.to), currency)}`}
                </p>
              </div>
              <div className="text-right">
                <Money value={Math.abs(s.amount)} currency={currency} className="font-semibold" />
                <p className="text-[11px] text-muted">≈ {formatMoney(s.annualCost, currency, { compact: true })}/year</p>
              </div>
              <div className="flex gap-1.5">
                {(s.direction === "inflow" ? (["income"] as const) : (["subscription", "bill"] as const)).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant={kind === "bill" ? "secondary" : "primary"}
                    loading={busy === s.merchantKey + kind}
                    onClick={async () => {
                      setBusy(s.merchantKey + kind);
                      const r = await confirmSuggestionAction({ merchantKey: s.merchantKey, kind });
                      setBusy(null);
                      if (!r.ok) return toast.error(r.error);
                      toast.success(`Added ${s.merchantName} as ${kind === "income" ? "income" : `a ${kind}`}`);
                      router.refresh();
                    }}
                  >
                    <Check /> {kind === "subscription" ? "Subscription" : kind === "bill" ? "Bill" : "Income"}
                  </Button>
                ))}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Not recurring: ${s.merchantName}`}
                  onClick={async () => {
                    const r = await dismissSuggestionAction({ merchantKey: s.merchantKey });
                    if (!r.ok) return toast.error(r.error);
                    router.refresh();
                  }}
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function RuleForm({ rule, kind: initialKind, today, currency, onDone }: { rule: Rule | null; kind: Rule["kind"]; today: string; currency: string; onDone: () => void }) {
  const router = useRouter();
  const { pickers } = useQuickAdd();
  const [kind, setKind] = React.useState<Rule["kind"]>(rule?.kind ?? initialKind);
  const [name, setName] = React.useState(rule?.name ?? "");
  const [amount, setAmount] = React.useState<number | null>(rule ? Math.abs(rule.amount) : null);
  const [varies, setVaries] = React.useState(rule?.amountVaries ?? false);
  const [accountId, setAccountId] = React.useState(rule?.accountId ?? pickers.accounts.find((a) => a.type === "checking")?.id ?? pickers.accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = React.useState(rule?.toAccountId ?? "");
  const [categoryId, setCategoryId] = React.useState(rule?.categoryId ?? "");
  const [frequency, setFrequency] = React.useState<Rule["frequency"]>(rule?.frequency ?? (initialKind === "income" ? "fortnightly" : "monthly"));
  const [interval, setInterval] = React.useState(rule?.interval ?? 2);
  const [unit, setUnit] = React.useState<"day" | "week" | "month" | "year">(rule?.unit ?? "week");
  const [anchor, setAnchor] = React.useState(rule?.anchorDate ?? today);
  const [endDate, setEndDate] = React.useState(rule?.endDate ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const transferish = kind === "transfer" || kind === "debt_payment";

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!amount) return setError("Enter the expected amount");
        setSaving(true);
        const payload = {
          name,
          kind,
          accountId,
          toAccountId: transferish ? toAccountId || null : null,
          categoryId: categoryId || null,
          amount,
          amountVaries: varies,
          frequency,
          interval: frequency === "custom" ? interval : null,
          unit: frequency === "custom" ? unit : null,
          anchorDate: anchor,
          endDate: endDate || null,
        };
        const r = rule ? await updateRuleAction({ id: rule.id, ...payload }) : await createRuleAction(payload);
        setSaving(false);
        if (!r.ok) return setError(r.error);
        toast.success(rule ? "Saved" : "Added — matching transactions will be linked automatically");
        router.refresh();
        onDone();
      }}
    >
      {error && <Alert tone="negative">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="r-kind">
          <Select id="r-kind" value={kind} onChange={(e) => setKind(e.target.value as Rule["kind"])}>
            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Name" htmlFor="r-name" hint="Use the name your bank shows so payments match automatically.">
          <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "income" ? "e.g. Salary — Acme Ltd" : "e.g. Mercury Energy"} maxLength={80} />
        </Field>
        <Field label="Expected amount" htmlFor="r-amt"><MoneyInput id="r-amt" value={amount} currency={currency} onChange={(v) => setAmount(v)} /></Field>
        <Field label={transferish ? "From account" : kind === "income" ? "Paid into" : "Paid from"} htmlFor="r-acc">
          <Select id="r-acc" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {pickers.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        {transferish && (
          <Field label="To account" htmlFor="r-to">
            <Select id="r-to" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">Choose…</option>
              {pickers.accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Category" htmlFor="r-cat" optional>
          <Select id="r-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            <CategoryOptions pickers={pickers} group={kind === "income" ? "income" : "expense"} />
          </Select>
        </Field>
        <Field label="How often" htmlFor="r-freq">
          <Select id="r-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as Rule["frequency"])}>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
            <option value="custom">Custom…</option>
          </Select>
        </Field>
        {frequency === "custom" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Every" htmlFor="r-int"><Input id="r-int" type="number" min={1} max={366} value={interval} onChange={(e) => setInterval(Number(e.target.value))} /></Field>
            <Field label="Unit" htmlFor="r-unit">
              <Select id="r-unit" value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
                <option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option>
              </Select>
            </Field>
          </div>
        )}
        <Field label={rule ? "Schedule starts" : "Next payment date"} htmlFor="r-anchor" hint="Monthly dates on the 29th–31st fall on the last day of shorter months.">
          <Input id="r-anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
        </Field>
        <Field label="Ends" htmlFor="r-end" optional><Input id="r-end" type="date" value={endDate} min={anchor} onChange={(e) => setEndDate(e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={varies} onChange={(e) => setVaries(e.target.checked)} /> The amount varies (e.g. power bill) — match within ±35%</label>
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>{rule ? "Save" : "Add"}</Button>
      </DialogFooter>
    </form>
  );
}
