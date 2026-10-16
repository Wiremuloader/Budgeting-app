"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Copy, Lightbulb, Settings2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Select } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogFooter, Tooltip } from "@/components/ui/overlay";
import { Money, MoneyInput } from "@/components/money";
import { BudgetBar } from "@/components/charts";
import { CategoryManager, type ManagedCategory } from "./category-manager";
import { applyAllocationsAction, copyPreviousMonthAction, moveMoneyAction, setAssignedAction, setBudgetMethodAction } from "@/server/actions/finance";
import type { BudgetCategoryView, BudgetMonthView } from "@/server/services/budget";
import { addMonthKey, formatMonthKey, monthEnd, monthStart } from "@/domain/dates";
import { formatMoney } from "@/domain/money";

export function BudgetView({ view, currency, currentMonth, categories }: { view: BudgetMonthView; currency: string; currentMonth: string; categories: ManagedCategory[] }) {
  const router = useRouter();
  const [move, setMove] = React.useState<{ to?: string; from?: string; amount?: number } | null>(null);
  const [manage, setManage] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const envelope = view.method === "envelope";
  const fmt = (c: number) => formatMoney(c, currency);

  async function switchMethod(method: "envelope" | "flexible") {
    if (method === view.method) return;
    const r = await setBudgetMethodAction({ method });
    if (!r.ok) return toast.error(r.error);
    toast.success(method === "envelope" ? "Switched to envelope budgeting" : "Switched to flexible budgeting", { description: "Your amounts and transaction history are unchanged." });
    router.refresh();
  }

  const topLevel = view.categories.filter((c) => !c.parentId);
  const childrenOf = (id: string) => view.categories.filter((c) => c.parentId === id);

  return (
    <>
      <PageHeader
        title="Budget"
        description={envelope ? "Give every dollar a job. Money left in a category rolls into next month." : "Set a limit for each category and track spending against it."}
        actions={
          <>
            <div role="radiogroup" aria-label="Budgeting method" className="inline-flex rounded-lg bg-surface-2 p-0.5 text-[13px]">
              {(["envelope", "flexible"] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={view.method === m}
                  onClick={() => switchMethod(m)}
                  className={cn("rounded-md px-3 py-1.5 font-medium capitalize", view.method === m ? "bg-surface shadow-card" : "text-muted hover:text-text")}
                >
                  {m === "envelope" ? "Envelope" : "Flexible"}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => setManage(true)}>
              <Settings2 /> Categories
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={`/budget?month=${addMonthKey(view.month, -1)}`} className="grid size-9 place-items-center rounded-md hover:bg-surface-2" aria-label="Previous month">
            <ChevronLeft className="size-4" />
          </Link>
          <h2 className="min-w-40 text-center text-lg font-semibold" aria-live="polite">
            {formatMonthKey(view.month)}
          </h2>
          <Link href={`/budget?month=${addMonthKey(view.month, 1)}`} className="grid size-9 place-items-center rounded-md hover:bg-surface-2" aria-label="Next month">
            <ChevronRight className="size-4" />
          </Link>
          {view.month !== currentMonth && (
            <Link href="/budget" className="ml-1 text-[13px] text-accent hover:underline">
              This month
            </Link>
          )}
        </div>
        {!view.hasAllocations && view.previousMonthHasAllocations && (
          <Button
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await copyPreviousMonthAction({ month: view.month });
              setBusy(false);
              if (!r.ok) return toast.error(r.error);
              toast.success(`Copied ${r.data} amounts from ${formatMonthKey(addMonthKey(view.month, -1))}`);
              router.refresh();
            }}
          >
            <Copy /> Copy last month’s budget
          </Button>
        )}
      </div>

      {/* Summary */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Budget summary">
        {envelope ? (
          <Card className={cn("col-span-2 p-4 lg:col-span-1", view.readyToAssign < 0 ? "border-negative/50 bg-negative-soft" : view.readyToAssign > 0 ? "border-accent/40 bg-accent-soft" : "")}>
            <p className="text-[13px] font-medium text-text-2">Ready to assign</p>
            <p className={cn("mt-1 text-[28px] font-semibold tracking-tight", view.readyToAssign < 0 && "text-negative")}>
              <Money value={view.readyToAssign} currency={currency} />
            </p>
            <p className="mt-1 text-xs text-text-2">
              {view.readyToAssign > 0 ? "Assign this to categories below." : view.readyToAssign < 0 ? "You’ve assigned more than you have. Reduce some categories." : "Every dollar has a job."}
            </p>
          </Card>
        ) : (
          <Card className={cn("col-span-2 p-4 lg:col-span-1", view.overPlanned > 0 && "border-warning/50 bg-warning-soft")}>
            <p className="text-[13px] font-medium text-text-2">Expected income</p>
            <p className="mt-1 text-[28px] font-semibold tracking-tight">
              <Money value={view.expectedIncome} currency={currency} />
            </p>
            <p className="mt-1 text-xs text-text-2">{view.overPlanned > 0 ? `Your limits are ${fmt(view.overPlanned)} more than expected income.` : "Recorded or scheduled income this month."}</p>
          </Card>
        )}
        <Stat label={envelope ? "Assigned this month" : "Planned spending"} value={view.totalAssigned} currency={currency} />
        <Stat label="Spent" value={view.totalSpent} currency={currency} note={view.overspentTotal > 0 ? `${fmt(view.overspentTotal)} overspent` : undefined} noteTone="negative" />
        <Stat label={envelope ? "Available in categories" : "Remaining"} value={view.totalAvailable} currency={currency} tone="negative" />
      </section>

      <div className="mt-4 space-y-3">
        {view.overspentDeducted > 0 && envelope && (
          <Alert tone="warning" icon={<CircleAlert />}>
            {fmt(view.overspentDeducted)} of overspending from {formatMonthKey(addMonthKey(view.month, -1))} was taken from this month’s ready-to-assign.
          </Alert>
        )}
        {view.uncategorisedOutflows > 0 && (
          <Alert tone="info" action={<Link href="/transactions?type=uncategorised" className="text-sm font-medium underline">Categorise</Link>}>
            {fmt(view.uncategorisedOutflows)} of spending this month has no category, so it isn’t in any envelope{envelope ? " (it’s been deducted from ready to assign)" : ""}.
          </Alert>
        )}
        {view.uncategorisedInflows > 0 && (
          <Alert tone="info" action={<Link href="/transactions?type=uncategorised" className="text-sm font-medium underline">Review</Link>}>
            {fmt(view.uncategorisedInflows)} of deposits need a category before they count as income.
          </Alert>
        )}
        {view.uncategorisedTransfersOut > 0 && envelope && (
          <Alert tone="info">{fmt(view.uncategorisedTransfersOut)} moved to off-budget accounts this month and was deducted from ready to assign.</Alert>
        )}
      </div>

      {view.suggestions.length > 0 && <Suggestions view={view} currency={currency} />}

      <Card className="mt-4 overflow-hidden">
        {view.categories.length === 0 ? (
          <EmptyState title="No spending categories" action={<Button onClick={() => setManage(true)}>Add a category</Button>} />
        ) : (
          <div role="table" aria-label={`Budget for ${formatMonthKey(view.month)}`}>
            <div role="row" className="hidden grid-cols-[minmax(0,1.6fr)_9rem_8rem_8.5rem_minmax(0,1fr)] items-center gap-4 border-b border-border bg-surface-2/60 px-4 py-2.5 text-xs font-medium text-muted md:grid">
              <span role="columnheader">Category</span>
              <span role="columnheader" className="text-right">
                {envelope ? "Assigned" : "Limit"}
              </span>
              <span role="columnheader" className="text-right">Spent</span>
              <span role="columnheader" className="text-right">
                {envelope ? "Available" : "Remaining"}
              </span>
              <span role="columnheader">Progress</span>
            </div>
            {topLevel.map((c) => (
              <React.Fragment key={c.id}>
                <BudgetRow key={`${c.id}:${c.assigned}`} c={c} view={view} currency={currency} onMove={(to, amount) => setMove({ to, amount })} />
                {childrenOf(c.id).map((child) => (
                  <BudgetRow key={`${child.id}:${child.assigned}`} c={child} view={view} currency={currency} child onMove={(to, amount) => setMove({ to, amount })} />
                ))}
              </React.Fragment>
            ))}
          </div>
        )}
      </Card>
      {envelope && (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => setMove({})}>
            <ArrowRightLeft /> Move money between categories
          </Button>
        </div>
      )}

      <MoveMoneyDialog state={move} onClose={() => setMove(null)} view={view} currency={currency} />
      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent title="Categories" description="Rename, reorder, nest or archive. Archived categories keep their history." size="lg">
          <CategoryManager categories={categories} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, currency, note, noteTone, tone }: { label: string; value: number; currency: string; note?: string; noteTone?: "negative"; tone?: "negative" }) {
  return (
    <Card className="p-4">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tracking-tight sm:text-[22px]">
        <Money value={value} currency={currency} tone={tone} />
      </p>
      {note && <p className={cn("mt-1 text-xs", noteTone === "negative" ? "text-negative" : "text-muted")}>{note}</p>}
    </Card>
  );
}

function BudgetRow({ c, view, currency, child, onMove }: { c: BudgetCategoryView; view: BudgetMonthView; currency: string; child?: boolean; onMove: (to: string, amount: number) => void }) {
  const router = useRouter();
  // The parent keys each row by its saved amount, so a server update resets local state.
  const [value, setValue] = React.useState<number | null>(c.assigned);
  const [saving, setSaving] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const envelope = view.method === "envelope";

  async function save() {
    if (value === null || value === c.assigned || value < 0) {
      if (value === null) setValue(c.assigned);
      return;
    }
    setSaving(true);
    const r = await setAssignedAction({ month: view.month, categoryId: c.id, amount: value });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      setValue(c.assigned);
      return;
    }
    router.refresh();
  }

  const budgeted = c.assigned + c.carryIn;
  const statusBadge =
    c.status === "over" ? (
      <Badge tone="negative">
        <CircleAlert className="size-3" /> Overspent
      </Badge>
    ) : c.status === "warning" ? (
      <Badge tone="warning">{c.usedBps !== null ? `${Math.round(c.usedBps / 100)}% used` : "Nearly there"}</Badge>
    ) : c.status === "unbudgeted" ? (
      <Badge tone="info">Not budgeted</Badge>
    ) : null;

  return (
    <div role="row" className={cn("border-b border-border last:border-0", c.archived && "opacity-60")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_9rem_8rem_8.5rem_minmax(0,1fr)]">
        <div role="cell" className={cn("min-w-0", child && "pl-5")}>
          <button className="flex max-w-full items-center gap-1.5 text-left text-sm font-medium" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <ChevronDown className={cn("size-3.5 shrink-0 text-muted transition-transform", !open && "-rotate-90")} aria-hidden />
            <span className="truncate">{c.name}</span>
          </button>
          <div className="ml-5 mt-0.5 flex flex-wrap items-center gap-1.5">
            {statusBadge}
            {c.archived && <Badge tone="outline">Archived</Badge>}
            {envelope && c.carryIn > 0 && (
              <Tooltip content="Unspent money carried over from last month">
                <span className="text-[11px] text-muted">+{formatMoney(c.carryIn, currency, { compact: true })} rolled over</span>
              </Tooltip>
            )}
          </div>
        </div>
        <div role="cell" className="w-32 justify-self-end md:w-full">
          <label className="sr-only" htmlFor={`assign-${c.id}`}>
            {envelope ? "Assigned" : "Limit"} for {c.name}
          </label>
          <div onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLElement).blur()} onBlur={save} className={cn(saving && "opacity-60")}>
            <MoneyInput id={`assign-${c.id}`} value={value} currency={currency} onChange={(v) => setValue(v)} className="[&_input]:h-8 [&_input]:text-right" />
          </div>
        </div>
        <div role="cell" className="text-right text-sm max-md:col-start-1 max-md:row-start-2 max-md:text-left">
          <span className="text-xs text-muted md:hidden">Spent </span>
          <Money value={c.spent} currency={currency} />
          {c.pendingSpent > 0 && <span className="block text-[11px] text-muted">incl. {formatMoney(c.pendingSpent, currency)} pending</span>}
        </div>
        <div role="cell" className="text-right max-md:row-start-2">
          <span
            className={cn(
              "num inline-flex rounded-full px-2.5 py-0.5 text-sm font-semibold",
              c.available < 0 ? "bg-negative-soft text-negative" : c.available === 0 ? "bg-surface-2 text-muted" : "bg-accent-soft text-positive",
            )}
          >
            {formatMoney(c.available, currency)}
          </span>
          {c.available < 0 && envelope && (
            <button className="mt-1 block w-full text-right text-[12px] font-medium text-accent hover:underline" onClick={() => onMove(c.id, -c.available)}>
              Cover overspending
            </button>
          )}
        </div>
        <div role="cell" className="col-span-2 md:col-span-1">
          <BudgetBar
            spent={Math.max(c.spent, 0)}
            budgeted={budgeted}
            projected={c.projected}
            label={`${c.name}: spent ${formatMoney(c.spent, currency)} of ${formatMoney(budgeted, currency)}${c.projected !== null ? `, projected ${formatMoney(c.projected, currency)}` : ""}`}
          />
          {view.isCurrent && c.projected !== null && budgeted > 0 && c.projected > budgeted && c.spent <= budgeted && (
            <p className="mt-1 text-[11px] text-warning">Projected {formatMoney(c.projected, currency, { compact: true })} by month end</p>
          )}
        </div>
      </div>
      {open && (
        <div className="grid gap-3 border-t border-dashed border-border bg-surface-2/40 px-4 py-3 text-[13px] text-text-2 sm:grid-cols-4">
          <Detail label="Last month">{formatMoney(c.previousSpent, currency)}</Detail>
          <Detail label="3-month average">{c.averageSpent === null ? "Not enough history" : formatMoney(c.averageSpent, currency)}</Detail>
          <Detail label="Projected month end">
            {c.projected === null ? "—" : formatMoney(c.projected, currency)}
            {c.projectionNote && <span className="mt-0.5 block text-[11px] text-muted">{c.projectionNote} Estimate only.</span>}
          </Detail>
          <Detail label="Still scheduled">{c.scheduledRemaining > 0 ? formatMoney(c.scheduledRemaining, currency) : "Nothing"}</Detail>
          <div className="sm:col-span-4">
            <Link href={`/transactions?category=${c.id}&from=${monthStart(view.month)}&to=${monthEnd(view.month)}`} className="font-medium text-accent hover:underline">
              View transactions →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="num mt-0.5">{children}</p>
    </div>
  );
}

function Suggestions({ view, currency }: { view: BudgetMonthView; currency: string }) {
  const router = useRouter();
  const [hidden, setHidden] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  if (hidden) return null;
  return (
    <Card className="mt-4">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Lightbulb className="size-4 text-warning" /> Suggested adjustments
          </span>
        }
        description="Based on your last three months. Nothing changes unless you apply it."
        action={
          <Button variant="ghost" size="sm" onClick={() => setHidden(true)}>
            Hide
          </Button>
        }
      />
      <CardBody>
        <ul className="divide-y divide-border">
          {view.suggestions.map((s) => (
            <li key={s.categoryId} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
              <div>
                <p className="font-medium">
                  {s.kind === "increase" ? "Raise" : "Lower"} {s.name} from {formatMoney(s.current, currency)} to {formatMoney(s.suggested, currency)}
                </p>
                <p className="text-xs text-muted">{s.reason.replace(/median spend (\d+)/, (_, n) => `median spend ${formatMoney(Number(n), currency)}`)}</p>
              </div>
              <Button
                size="sm"
                loading={busy === s.categoryId}
                onClick={async () => {
                  setBusy(s.categoryId);
                  const r = await applyAllocationsAction({ month: view.month, allocations: [{ categoryId: s.categoryId, amount: s.suggested }] });
                  setBusy(null);
                  if (!r.ok) return toast.error(r.error);
                  toast.success(`${s.name} set to ${formatMoney(s.suggested, currency)}`);
                  router.refresh();
                }}
              >
                <Sparkles /> Apply
              </Button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function MoveMoneyDialog({ state, onClose, view, currency }: { state: { to?: string; from?: string; amount?: number } | null; onClose: () => void; view: BudgetMonthView; currency: string }) {
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Move money" description="Shift available money from one category to another. Your total doesn’t change." size="sm">
        {state && <MoveMoneyForm key={JSON.stringify(state)} initial={state} onClose={onClose} view={view} currency={currency} />}
      </DialogContent>
    </Dialog>
  );
}

function MoveMoneyForm({ initial, onClose, view, currency }: { initial: { to?: string; from?: string; amount?: number }; onClose: () => void; view: BudgetMonthView; currency: string }) {
  const router = useRouter();
  const donor = view.categories.filter((c) => c.id !== initial.to && c.available > 0).sort((a, b) => b.available - a.available)[0];
  const [from, setFrom] = React.useState(initial.from ?? donor?.id ?? "");
  const [to, setTo] = React.useState(initial.to ?? "");
  const [amount, setAmount] = React.useState<number | null>(initial.amount ?? null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fromCat = view.categories.find((c) => c.id === from);

  return (
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!from || !to || !amount) return setError("Choose both categories and an amount");
            setSaving(true);
            const r = await moveMoneyAction({ month: view.month, from, to, amount });
            setSaving(false);
            if (!r.ok) return setError(r.error);
            toast.success("Money moved");
            onClose();
            router.refresh();
          }}
        >
          {error && <Alert tone="negative">{error}</Alert>}
          <Field label="From" htmlFor="mm-from" hint={fromCat ? `${formatMoney(fromCat.available, currency)} available` : undefined}>
            <Select id="mm-from" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">Choose…</option>
              {view.categories
                .filter((c) => c.id !== to)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({formatMoney(c.available, currency)})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="To" htmlFor="mm-to">
            <Select id="mm-to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose…</option>
              {view.categories
                .filter((c) => c.id !== from)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({formatMoney(c.available, currency)})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="mm-amount">
            <MoneyInput id="mm-amount" value={amount} currency={currency} onChange={(v) => setAmount(v)} />
          </Field>
          {fromCat && amount !== null && amount > fromCat.available && <Alert tone="warning">This leaves {fromCat.name} overspent by {formatMoney(amount - fromCat.available, currency)}.</Alert>}
          <DialogFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>
              Move
            </Button>
          </DialogFooter>
        </form>
  );
}
