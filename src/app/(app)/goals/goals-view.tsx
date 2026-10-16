"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, CheckCircle2, Minus, MoreHorizontal, Pause, Pencil, PiggyBank, Play, Plus, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Progress, Select } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Money, MoneyInput } from "@/components/money";
import { addContributionAction, createGoalAction, deleteGoalAction, setGoalStatusAction, updateGoalAction } from "@/server/actions/finance";
import type { GoalView } from "@/server/services/goals";
import { goalScenarios, type ContributionCadence } from "@/domain/goals";
import { formatDisplayDate } from "@/domain/dates";
import { formatMoney } from "@/domain/money";

type Goal = Omit<GoalView, "createdAt" | "updatedAt" | "completedAt"> & { createdAt: string; updatedAt: string; completedAt: string | null };

const KINDS: { value: Goal["kind"]; label: string }[] = [
  { value: "emergency_fund", label: "Emergency fund" },
  { value: "car", label: "First car" },
  { value: "holiday", label: "Holiday" },
  { value: "laptop", label: "Laptop" },
  { value: "house_deposit", label: "House deposit" },
  { value: "education", label: "Education" },
  { value: "major_purchase", label: "Major purchase" },
  { value: "custom", label: "Something else" },
];

const per = (c: string) => (c === "weekly" ? "week" : c === "fortnightly" ? "fortnight" : "month");

export function GoalsView({
  goals,
  accounts,
  warnings,
  today,
  currency,
  openNew,
}: {
  goals: Goal[];
  accounts: { id: string; name: string; balance: number }[];
  warnings: { accountId: string; accountName: string; earmarked: number; accountBalance: number; overAllocated: number }[];
  today: string;
  currency: string;
  openNew: boolean;
}) {
  const [editing, setEditing] = React.useState<Goal | "new" | null>(openNew ? "new" : null);
  const [contrib, setContrib] = React.useState<{ goal: Goal; direction: 1 | -1 } | null>(null);
  const [deleting, setDeleting] = React.useState<Goal | null>(null);
  const [showDone, setShowDone] = React.useState(false);
  const router = useRouter();
  const active = goals.filter((g) => g.status === "active" || g.status === "paused");
  const done = goals.filter((g) => g.status === "completed" || g.status === "archived");
  const totalSaved = active.reduce((a, g) => a + g.savedAmount, 0);
  const totalTarget = active.reduce((a, g) => a + g.targetAmount, 0);

  async function status(g: Goal, s: Goal["status"], msg: string) {
    const r = await setGoalStatusAction({ id: g.id, status: s });
    if (!r.ok) return toast.error(r.error);
    toast.success(msg);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Savings goals"
        description="Set money aside for what matters. Goal amounts are earmarks within your accounts — Ledger never moves real money."
        actions={
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus /> New goal
          </Button>
        }
      />

      {warnings.map((w) => (
        <Alert key={w.accountId} tone="warning" icon={<TriangleAlert />} className="mb-4">
          Goals linked to {w.accountName} add up to {formatMoney(w.earmarked, currency)}, but the account holds {formatMoney(w.accountBalance, currency)}. {formatMoney(w.overAllocated, currency)} of your goal progress isn’t backed by money in that account.
        </Alert>
      ))}

      {active.length > 0 && (
        <Card className="mb-5 flex flex-wrap items-center gap-6 p-5">
          <div>
            <p className="text-[13px] text-muted">Saved across active goals</p>
            <p className="mt-1 text-2xl font-semibold"><Money value={totalSaved} currency={currency} /> <span className="text-base font-normal text-muted">of <Money value={totalTarget} currency={currency} /></span></p>
          </div>
          <Progress value={totalSaved} max={totalTarget} className="h-2 min-w-40 flex-1" label="Total goal progress" />
        </Card>
      )}

      {goals.length === 0 ? (
        <Card>
          <EmptyState icon={<PiggyBank />} title="No goals yet" action={<Button variant="primary" onClick={() => setEditing("new")}>Create a goal</Button>}>
            Many people start with an emergency fund of a few weeks’ expenses. Pick a target that works for you.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {active.map((g) => (
            <GoalCard
              key={g.id}
              g={g}
              currency={currency}
              today={today}
              accountName={accounts.find((a) => a.id === g.linkedAccountId)?.name ?? null}
              onContribute={(direction) => setContrib({ goal: g, direction })}
              menu={
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${g.name}`}><MoreHorizontal /></Button>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem icon={<Pencil />} onSelect={() => setEditing(g)}>Edit goal</MenuItem>
                    {g.status === "active" ? (
                      <MenuItem icon={<Pause />} onSelect={() => status(g, "paused", "Goal paused")}>Pause</MenuItem>
                    ) : (
                      <MenuItem icon={<Play />} onSelect={() => status(g, "active", "Goal resumed")}>Resume</MenuItem>
                    )}
                    <MenuItem icon={<CheckCircle2 />} onSelect={() => status(g, "completed", "Marked complete — well done!")}>Mark complete</MenuItem>
                    <MenuItem icon={<Archive />} onSelect={() => status(g, "archived", "Goal archived")}>Archive</MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(g)}>Delete</MenuItem>
                  </MenuContent>
                </Menu>
              }
            />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-6">
          <label className="flex items-center gap-2 text-sm text-muted">
            <Checkbox checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show {done.length} completed or archived goal{done.length > 1 ? "s" : ""}
          </label>
          {showDone && (
            <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
              {done.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span>
                    {g.name} <Badge tone={g.status === "completed" ? "positive" : "outline"}>{g.status}</Badge>
                  </span>
                  <span className="flex items-center gap-2">
                    <Money value={g.savedAmount} currency={currency} />
                    <Button size="sm" variant="ghost" onClick={() => status(g, "active", "Goal reactivated")}>Reactivate</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent title={editing === "new" ? "New savings goal" : `Edit ${editing.name}`}>
            <GoalForm goal={editing === "new" ? null : editing} accounts={accounts} currency={currency} today={today} onDone={() => setEditing(null)} />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={!!contrib} onOpenChange={(o) => !o && setContrib(null)}>
        {contrib && (
          <DialogContent title={contrib.direction === 1 ? `Add to ${contrib.goal.name}` : `Take from ${contrib.goal.name}`} description="This records money set aside (or used). It doesn’t move money between accounts." size="sm">
            <ContributionForm goal={contrib.goal} direction={contrib.direction} currency={currency} today={today} onDone={() => setContrib(null)} />
          </DialogContent>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="The goal and its contribution history are removed. Your account balances aren’t affected."
        confirmLabel="Delete goal"
        danger
        onConfirm={async () => {
          const r = await deleteGoalAction({ id: deleting!.id });
          setDeleting(null);
          if (!r.ok) return toast.error(r.error);
          toast.success("Goal deleted");
          router.refresh();
        }}
      />
    </>
  );
}

function GoalCard({ g, currency, today, accountName, onContribute, menu }: { g: Goal; currency: string; today: string; accountName: string | null; onContribute: (d: 1 | -1) => void; menu: React.ReactNode }) {
  const p = g.progress;
  const [scenario, setScenario] = React.useState<number>(g.plannedContribution ?? Math.max(p.requiredPerPeriod ?? 5_000, 1_000));
  const s = goalScenarios({ targetAmount: g.targetAmount, savedAmount: g.savedAmount, plannedContribution: g.plannedContribution, cadence: g.cadence as ContributionCadence }, today, [scenario])[0];
  const statusBadge = {
    complete: <Badge tone="positive">Reached</Badge>,
    on_track: <Badge tone="positive">On track</Badge>,
    behind: <Badge tone="warning">Behind target date</Badge>,
    overdue: <Badge tone="negative">Target date passed</Badge>,
    no_target_date: <Badge>No target date</Badge>,
    no_plan: <Badge tone="info">No regular contribution</Badge>,
  }[p.status];
  const maxSlider = Math.max(p.remaining, (g.plannedContribution ?? 0) * 4, 10_000);

  return (
    <Card className={cn("flex flex-col p-5", g.status === "paused" && "opacity-75")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{g.name}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {g.status === "paused" ? <Badge>Paused</Badge> : statusBadge}
            {g.targetDate && <span>by {formatDisplayDate(g.targetDate, { year: true })}</span>}
            {accountName && <span>· in {accountName}</span>}
          </p>
        </div>
        {menu}
      </div>
      <div className="mt-4 flex items-baseline justify-between">
        <p className="text-2xl font-semibold"><Money value={g.savedAmount} currency={currency} /></p>
        <p className="text-sm text-muted">of <Money value={g.targetAmount} currency={currency} /></p>
      </div>
      <Progress value={p.progressBps} max={10_000} className="mt-2 h-2" label={`${g.name}: ${Math.round(p.progressBps / 100)}%`} />
      <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <dt className="text-muted">Still to save</dt>
          <dd className="font-medium"><Money value={p.remaining} currency={currency} /></dd>
        </div>
        <div>
          <dt className="text-muted">{p.requiredPerPeriod !== null ? `Needed per ${per(g.cadence)}` : "Planned"}</dt>
          <dd className="font-medium">
            {p.requiredPerPeriod !== null ? <Money value={p.requiredPerPeriod} currency={currency} /> : g.plannedContribution ? <>{formatMoney(g.plannedContribution, currency)}/{per(g.cadence)}</> : "—"}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">Estimated completion</dt>
          <dd className="font-medium">
            {p.estimatedCompletion ? formatDisplayDate(p.estimatedCompletion, { year: true }) : "Add a planned contribution to estimate"}
            {g.plannedContribution ? <span className="font-normal text-muted"> at {formatMoney(g.plannedContribution, currency)}/{per(g.cadence)}</span> : null}
          </dd>
        </div>
      </dl>

      {!p.complete && (
        <details className="mt-4 rounded-lg bg-surface-2 p-3 text-[13px]">
          <summary className="cursor-pointer font-medium">What if I saved a different amount?</summary>
          <label className="mt-3 block" htmlFor={`sc-${g.id}`}>
            <span className="text-muted">Save per {per(g.cadence)}: </span>
            <span className="num font-semibold">{formatMoney(scenario, currency)}</span>
          </label>
          <input
            id={`sc-${g.id}`}
            type="range"
            min={500}
            max={maxSlider}
            step={500}
            value={scenario}
            onChange={(e) => setScenario(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
          />
          <p className="mt-2">
            {s.completion ? (
              <>
                Done by <strong>{formatDisplayDate(s.completion, { year: true })}</strong> ({s.periods} {per(g.cadence)}s)
                {s.deltaDays !== null && s.deltaDays !== 0 && (
                  <span className={s.deltaDays > 0 ? "text-positive" : "text-warning"}>
                    {" "}— {Math.abs(Math.round(s.deltaDays / 7))} weeks {s.deltaDays > 0 ? "sooner" : "later"} than your plan
                  </span>
                )}
                {g.targetDate && <span className="block text-muted">{s.completion <= g.targetDate ? "Meets your target date." : "Misses your target date."}</span>}
              </>
            ) : (
              "—"
            )}
          </p>
          <p className="mt-1 text-xs text-muted">Estimate assuming you contribute every {per(g.cadence)}.</p>
        </details>
      )}

      <div className="mt-auto flex gap-2 pt-4">
        <Button size="sm" variant="primary" onClick={() => onContribute(1)} disabled={g.status !== "active"}>
          <Plus /> Add money
        </Button>
        <Button size="sm" onClick={() => onContribute(-1)} disabled={g.savedAmount <= 0}>
          <Minus /> Use money
        </Button>
      </div>
      {g.contributions.length > 0 && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">Recent activity</summary>
          <ul className="mt-2 space-y-1">
            {g.contributions.slice(0, 6).map((c) => (
              <li key={c.id} className="flex justify-between">
                <span>{formatDisplayDate(c.date)}{c.note ? ` · ${c.note}` : ""}</span>
                <Money value={c.amount} currency={currency} signed />
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function GoalForm({ goal, accounts, currency, today, onDone }: { goal: Goal | null; accounts: { id: string; name: string }[]; currency: string; today: string; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = React.useState(goal?.name ?? "Emergency fund");
  const [kind, setKind] = React.useState<Goal["kind"]>(goal?.kind ?? "emergency_fund");
  const [target, setTarget] = React.useState<number | null>(goal?.targetAmount ?? null);
  const [targetDate, setTargetDate] = React.useState(goal?.targetDate ?? "");
  const [cadence, setCadence] = React.useState<ContributionCadence>((goal?.cadence as ContributionCadence) ?? "fortnightly");
  const [planned, setPlanned] = React.useState<number | null>(goal?.plannedContribution ?? null);
  const [linked, setLinked] = React.useState(goal?.linkedAccountId ?? "");
  const [priority, setPriority] = React.useState(goal?.priority ?? 2);
  const [initial, setInitial] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError("Give your goal a name");
        if (!target) return setError("Enter a target amount");
        setSaving(true);
        const payload = { name, kind, targetAmount: target, targetDate: targetDate || null, cadence, plannedContribution: planned, linkedAccountId: linked || null, priority };
        const r = goal ? await updateGoalAction({ id: goal.id, ...payload }) : await createGoalAction({ ...payload, initialSaved: initial ?? undefined });
        setSaving(false);
        if (!r.ok) return setError(r.error);
        toast.success(goal ? "Goal updated" : "Goal created");
        router.refresh();
        onDone();
      }}
    >
      {error && <Alert tone="negative">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What are you saving for?" htmlFor="g-kind">
          <Select id="g-kind" value={kind} onChange={(e) => { const k = e.target.value as Goal["kind"]; setKind(k); if (!name || KINDS.some((x) => x.label === name)) setName(KINDS.find((x) => x.value === k)!.label); }}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Name" htmlFor="g-name"><Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Field label="Target amount" htmlFor="g-target"><MoneyInput id="g-target" value={target} currency={currency} onChange={(v) => setTarget(v)} /></Field>
        <Field label="Target date" htmlFor="g-date" optional><Input id="g-date" type="date" min={today} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></Field>
        <Field label="I’ll save" htmlFor="g-planned" optional>
          <MoneyInput id="g-planned" value={planned} currency={currency} onChange={(v) => setPlanned(v)} />
        </Field>
        <Field label="Every" htmlFor="g-cadence">
          <Select id="g-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as ContributionCadence)}>
            <option value="weekly">Week</option>
            <option value="fortnightly">Fortnight</option>
            <option value="monthly">Month</option>
          </Select>
        </Field>
        <Field label="Kept in" htmlFor="g-acc" optional hint="Ledger warns you if goals add up to more than the account holds.">
          <Select id="g-acc" value={linked} onChange={(e) => setLinked(e.target.value)}>
            <option value="">Not linked</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="g-pri">
          <Select id="g-pri" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={1}>High</option>
            <option value={2}>Medium</option>
            <option value={3}>Low</option>
          </Select>
        </Field>
        {!goal && (
          <Field label="Already saved" htmlFor="g-init" optional>
            <MoneyInput id="g-init" value={initial} currency={currency} onChange={(v) => setInitial(v)} />
          </Field>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>{goal ? "Save" : "Create goal"}</Button>
      </DialogFooter>
    </form>
  );
}

function ContributionForm({ goal, direction, currency, today, onDone }: { goal: Goal; direction: 1 | -1; currency: string; today: string; onDone: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = React.useState<number | null>(direction === 1 ? (goal.plannedContribution ?? null) : null);
  const [date, setDate] = React.useState(today);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!amount) return setError("Enter an amount");
        setSaving(true);
        const r = await addContributionAction({ goalId: goal.id, amount: direction * amount, date, note: note || null });
        setSaving(false);
        if (!r.ok) return setError(r.error);
        toast.success(r.data.completed ? `You reached “${goal.name}”! 🎉` : direction === 1 ? "Added" : "Recorded");
        router.refresh();
        onDone();
      }}
    >
      {error && <Alert tone="negative">{error}</Alert>}
      <Field label="Amount" htmlFor="c-amt"><MoneyInput id="c-amt" value={amount} currency={currency} onChange={(v) => setAmount(v)} autoFocus /></Field>
      <Field label="Date" htmlFor="c-date"><Input id="c-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Note" htmlFor="c-note" optional><Input id="c-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>{direction === 1 ? "Add to goal" : "Take from goal"}</Button>
      </DialogFooter>
    </form>
  );
}
