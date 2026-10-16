"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, Button, Card, Field, Input, Progress, Select } from "@/components/ui/primitives";
import { MoneyInput, Money } from "@/components/money";
import { completeOnboardingAction, skipOnboardingAction } from "@/server/actions/settings";
import { buildStarterBudget, monthlyEquivalent } from "@/domain/budget";
import { addDays } from "@/domain/dates";
import { mulDiv, sum } from "@/domain/money";

type Freq = "weekly" | "fortnightly" | "monthly";
type BillFreq = Freq | "quarterly" | "yearly";

const FIXED_PRESETS: { key: string; name: string; categoryKey: string; frequency: BillFreq }[] = [
  { key: "rent", name: "Rent or mortgage", categoryKey: "housing", frequency: "weekly" },
  { key: "power", name: "Power", categoryKey: "utilities", frequency: "monthly" },
  { key: "internet", name: "Phone & internet", categoryKey: "phone_internet", frequency: "monthly" },
  { key: "insurance", name: "Insurance", categoryKey: "insurance", frequency: "monthly" },
  { key: "subs", name: "Streaming & subscriptions", categoryKey: "subscriptions", frequency: "monthly" },
  { key: "transport", name: "Public transport pass", categoryKey: "transport", frequency: "monthly" },
  { key: "gym", name: "Gym", categoryKey: "health", frequency: "monthly" },
];

const VARIABLE: { key: string; label: string }[] = [
  { key: "groceries", label: "Groceries" },
  { key: "restaurants", label: "Eating out & takeaway" },
  { key: "transport", label: "Fuel & transport" },
  { key: "entertainment", label: "Entertainment" },
  { key: "shopping", label: "Shopping" },
  { key: "health", label: "Health" },
  { key: "personal_care", label: "Personal care" },
  { key: "education", label: "Education" },
  { key: "gifts", label: "Gifts & donations" },
  { key: "miscellaneous", label: "Everything else" },
];

const PRIORITIES = ["Stop living paycheck to paycheck", "Build an emergency fund", "Pay off debt", "Save for something big", "Understand where my money goes", "Share costs with someone"];

const STEPS = ["Region", "Income", "Accounts", "Bills", "Spending", "Debts", "Goals", "Budget style", "Review"] as const;

interface State {
  country: string;
  currency: string;
  timezone: string;
  incomeFrequency: Freq | "irregular" | null;
  incomes: { name: string; amount: number | null; frequency: Freq; nextDate: string }[];
  accounts: { name: string; type: "checking" | "savings" | "cash" | "credit_card"; balance: number | null }[];
  fixed: Record<string, { on: boolean; amount: number | null; frequency: BillFreq; nextDate: string }>;
  variable: Record<string, { on: boolean; typical: number | null }>;
  debts: { name: string; kind: "credit_card" | "personal_loan" | "student_loan" | "vehicle" | "mortgage" | "other"; balanceOwed: number | null; rate: string; minimumPayment: number | null }[];
  goals: { name: string; kind: "emergency_fund" | "car" | "holiday" | "laptop" | "house_deposit" | "education" | "major_purchase" | "custom"; targetAmount: number | null; targetDate: string; plannedContribution: number | null; cadence: Freq }[];
  budgetMethod: "envelope" | "flexible";
  budgetMode: "guided" | "manual";
  safetyBuffer: number | null;
  priorities: string[];
  allocations: Record<string, number>;
}

function rateToBps(rate: string): number {
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(rate.trim())) return 0;
  const [w, f = ""] = rate.trim().split(".");
  return Number(w) * 100 + Number(f.padEnd(2, "0"));
}

function toMonthly(amount: number, f: BillFreq): number {
  if (f === "quarterly") return mulDiv(amount, 1, 3);
  if (f === "yearly") return mulDiv(amount, 1, 12);
  return monthlyEquivalent(amount, f);
}

export function OnboardingWizard({ name, today, hasAccounts }: { name: string; today: string; hasAccounts: boolean }) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const tz = React.useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Pacific/Auckland";
    } catch {
      return "Pacific/Auckland";
    }
  }, []);
  const [s, setS] = React.useState<State>(() => ({
    country: "NZ",
    currency: "NZD",
    timezone: tz,
    incomeFrequency: "fortnightly",
    incomes: [{ name: "Pay", amount: null, frequency: "fortnightly", nextDate: addDays(today, 7) }],
    accounts: hasAccounts ? [] : [{ name: "Everyday account", type: "checking", balance: null }],
    fixed: Object.fromEntries(FIXED_PRESETS.map((f) => [f.key, { on: f.key === "rent" || f.key === "power", amount: null, frequency: f.frequency, nextDate: addDays(today, 3) }])),
    variable: Object.fromEntries(VARIABLE.map((v) => [v.key, { on: ["groceries", "restaurants", "transport", "entertainment", "miscellaneous"].includes(v.key), typical: null }])),
    debts: [],
    goals: [{ name: "Emergency fund", kind: "emergency_fund", targetAmount: null, targetDate: "", plannedContribution: null, cadence: "fortnightly" }],
    budgetMethod: "envelope",
    budgetMode: "guided",
    safetyBuffer: 10_000,
    priorities: [],
    allocations: {},
  }));
  const set = (patch: Partial<State>) => setS((x) => ({ ...x, ...patch }));

  const monthlyIncome = sum(s.incomes.filter((i) => i.amount).map((i) => monthlyEquivalent(i.amount!, i.frequency)));
  const fixedRows = FIXED_PRESETS.filter((f) => s.fixed[f.key].on && s.fixed[f.key].amount);
  const starter = React.useMemo(() => {
    const byCat = new Map<string, number>();
    for (const f of fixedRows) byCat.set(f.categoryKey, (byCat.get(f.categoryKey) ?? 0) + toMonthly(s.fixed[f.key].amount!, s.fixed[f.key].frequency));
    return buildStarterBudget({
      monthlyIncome,
      fixed: [...byCat.entries()].map(([categoryKey, amount]) => ({ categoryKey, amount })),
      debtMinimums: sum(s.debts.map((d) => d.minimumPayment ?? 0)),
      goalContributions: sum(s.goals.filter((g) => g.plannedContribution).map((g) => monthlyEquivalent(g.plannedContribution!, g.cadence))),
      variable: VARIABLE.filter((v) => s.variable[v.key].on && !byCat.has(v.key)).map((v) => ({ categoryKey: v.key, typical: s.variable[v.key].typical })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.incomes, s.fixed, s.variable, s.debts, s.goals]);

  function goTo(next: number) {
    // Entering the review step drafts the starter budget from the latest answers.
    if (STEPS[next] === "Review") set({ allocations: Object.fromEntries(starter.allocations.map((a) => [a.categoryKey, a.amount])) });
    setStep(next);
  }

  async function finish() {
    setSaving(true);
    setError(null);
    const r = await completeOnboardingAction({
      country: s.country,
      currency: s.currency,
      timezone: s.timezone,
      incomeFrequency: s.incomeFrequency,
      budgetMode: s.budgetMode,
      budgetMethod: s.budgetMethod,
      safetyBuffer: s.safetyBuffer ?? 0,
      priorities: s.priorities,
      accounts: s.accounts.filter((a) => a.name.trim()).map((a) => ({ name: a.name, type: a.type, balance: a.balance ?? 0 })),
      incomes: s.incomes.filter((i) => i.name.trim() && i.amount).map((i) => ({ name: i.name, amount: i.amount!, frequency: i.frequency, nextDate: i.nextDate })),
      fixed: fixedRows.map((f) => ({ categoryKey: f.categoryKey, name: f.name, amount: s.fixed[f.key].amount!, frequency: s.fixed[f.key].frequency, nextDate: s.fixed[f.key].nextDate })),
      debts: s.debts.filter((d) => d.name.trim() && d.balanceOwed !== null).map((d) => ({ name: d.name, kind: d.kind, balanceOwed: d.balanceOwed!, aprBps: rateToBps(d.rate), minimumPayment: d.minimumPayment ?? 0 })),
      goals: s.goals.filter((g) => g.name.trim() && g.targetAmount).map((g) => ({ name: g.name, kind: g.kind, targetAmount: g.targetAmount!, targetDate: g.targetDate || null, plannedContribution: g.plannedContribution, cadence: g.cadence })),
      allocations: s.budgetMode === "guided" ? Object.entries(s.allocations).map(([categoryKey, amount]) => ({ categoryKey, amount })) : [],
    });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    toast.success("You’re all set up");
    router.replace("/overview");
    router.refresh();
  }

  const stepName = STEPS[step];
  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-muted">Step {step + 1} of {STEPS.length} · {stepName}</p>
        <button
          className="text-sm text-muted underline-offset-2 hover:text-text hover:underline"
          onClick={async () => {
            await skipOnboardingAction();
            router.replace("/overview");
            router.refresh();
          }}
        >
          Skip setup for now
        </button>
      </div>
      <Progress value={step + 1} max={STEPS.length} label="Setup progress" className="mb-8" />

      <Card className="p-6 sm:p-8">
        {error && <Alert tone="negative" className="mb-4">{error}</Alert>}

        {stepName === "Region" && (
          <Section title={`Kia ora ${name} — let’s set things up`} lead="A few questions so Ledger can build a budget around your real numbers. Skip anything you’re not sure about.">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Country" htmlFor="o-c"><Select id="o-c" value={s.country} onChange={(e) => set({ country: e.target.value, currency: { NZ: "NZD", AU: "AUD", GB: "GBP", US: "USD" }[e.target.value] ?? s.currency })}><option value="NZ">New Zealand</option><option value="AU">Australia</option><option value="GB">United Kingdom</option><option value="US">United States</option></Select></Field>
              <Field label="Currency" htmlFor="o-cur"><Select id="o-cur" value={s.currency} onChange={(e) => set({ currency: e.target.value })}>{["NZD", "AUD", "GBP", "USD", "EUR"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Time zone" htmlFor="o-tz"><Input id="o-tz" value={s.timezone} onChange={(e) => set({ timezone: e.target.value })} /></Field>
            </div>
          </Section>
        )}

        {stepName === "Income" && (
          <Section title="How do you get paid?" lead="Your pay after tax — what lands in your account. We use it to count down to payday and to plan your budget.">
            <div role="radiogroup" aria-label="How often you're paid" className="mb-5 flex flex-wrap gap-2">
              {(["weekly", "fortnightly", "monthly", "irregular"] as const).map((f) => (
                <Chip key={f} on={s.incomeFrequency === f} onClick={() => set({ incomeFrequency: f, incomes: s.incomes.map((i) => ({ ...i, frequency: f === "irregular" ? "monthly" : f })) })}>{f === "irregular" ? "It varies" : f[0].toUpperCase() + f.slice(1)}</Chip>
              ))}
            </div>
            {s.incomeFrequency === "irregular" && <p className="mb-4 text-sm text-muted">Enter a typical month. Ledger only budgets income once it actually arrives.</p>}
            <Rows
              items={s.incomes}
              onChange={(incomes) => set({ incomes })}
              blank={{ name: "", amount: null, frequency: s.incomeFrequency === "weekly" || s.incomeFrequency === "monthly" ? s.incomeFrequency : "fortnightly", nextDate: addDays(today, 7) }}
              addLabel="Add another income"
              render={(it, upd, i) => (
                <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr_1fr]">
                  <Field label="Source" htmlFor={`inc-n-${i}`}><Input id={`inc-n-${i}`} value={it.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Salary" /></Field>
                  <Field label="Amount each time" htmlFor={`inc-a-${i}`}><MoneyInput id={`inc-a-${i}`} value={it.amount} currency={s.currency} onChange={(v) => upd({ amount: v })} /></Field>
                  <Field label="How often" htmlFor={`inc-f-${i}`}><Select id={`inc-f-${i}`} value={it.frequency} onChange={(e) => upd({ frequency: e.target.value as Freq })}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option></Select></Field>
                  <Field label="Next payday" htmlFor={`inc-d-${i}`}><Input id={`inc-d-${i}`} type="date" value={it.nextDate} min={today} onChange={(e) => upd({ nextDate: e.target.value })} /></Field>
                </div>
              )}
            />
            {monthlyIncome > 0 && <p className="mt-4 text-sm text-muted">That’s about <Money value={monthlyIncome} currency={s.currency} className="font-medium text-text" /> a month on average.</p>}
          </Section>
        )}

        {stepName === "Accounts" && (
          <Section title="Which accounts do you use?" lead="Enter today’s balances. You can import transaction history from your bank later. We never need your banking login.">
            {hasAccounts && <Alert tone="info" className="mb-4">You already have accounts set up. Add more here or skip this step.</Alert>}
            <Rows
              items={s.accounts}
              onChange={(accounts) => set({ accounts })}
              blank={{ name: "", type: "savings", balance: null }}
              addLabel="Add an account"
              render={(a, upd, i) => (
                <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
                  <Field label="Name" htmlFor={`acc-${i}`}><Input id={`acc-${i}`} value={a.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. ANZ Everyday" /></Field>
                  <Field label="Type" htmlFor={`acct-${i}`}><Select id={`acct-${i}`} value={a.type} onChange={(e) => upd({ type: e.target.value as State["accounts"][number]["type"] })}><option value="checking">Everyday</option><option value="savings">Savings</option><option value="cash">Cash</option><option value="credit_card">Credit card</option></Select></Field>
                  <Field label={a.type === "credit_card" ? "Amount owed" : "Balance"} htmlFor={`accb-${i}`}><MoneyInput id={`accb-${i}`} value={a.balance} currency={s.currency} allowNegative={a.type !== "credit_card"} onChange={(v) => upd({ balance: v })} /></Field>
                </div>
              )}
            />
          </Section>
        )}

        {stepName === "Bills" && (
          <Section title="Regular bills" lead="Tick the bills you pay and roughly how much. Ledger will remind you before they’re due, and only mark them paid when the payment appears.">
            <ul className="space-y-2">
              {FIXED_PRESETS.map((f) => {
                const v = s.fixed[f.key];
                const upd = (patch: Partial<typeof v>) => set({ fixed: { ...s.fixed, [f.key]: { ...v, ...patch } } });
                return (
                  <li key={f.key} className={cn("rounded-lg border p-3", v.on ? "border-accent/50 bg-accent-soft/30" : "border-border")}>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={v.on} onChange={(e) => upd({ on: e.target.checked })} />
                      {f.name}
                    </label>
                    {v.on && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <div><label htmlFor={`bill-${f.key}`} className="sr-only">{f.name} amount</label><MoneyInput id={`bill-${f.key}`} value={v.amount} currency={s.currency} onChange={(x) => upd({ amount: x })} /></div>
                        <Select value={v.frequency} onChange={(e) => upd({ frequency: e.target.value as BillFreq })} aria-label={`${f.name} frequency`}>
                          <option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option>
                        </Select>
                        <Input type="date" value={v.nextDate} min={today} onChange={(e) => upd({ nextDate: e.target.value })} aria-label={`${f.name} next due date`} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {stepName === "Spending" && (
          <Section title="What else do you spend on?" lead="Choose your everyday categories. Add a typical monthly amount if you know it — otherwise we’ll suggest a starting point from what’s left after bills.">
            <div className="grid gap-2 sm:grid-cols-2">
              {VARIABLE.map((v) => {
                const st = s.variable[v.key];
                return (
                  <div key={v.key} className={cn("rounded-lg border p-3", st.on ? "border-accent/50 bg-accent-soft/30" : "border-border")}>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={st.on} onChange={(e) => set({ variable: { ...s.variable, [v.key]: { ...st, on: e.target.checked } } })} />
                      {v.label}
                    </label>
                    {st.on && (
                      <div className="mt-2">
                        <label htmlFor={`var-${v.key}`} className="sr-only">Typical monthly spend on {v.label}</label><MoneyInput id={`var-${v.key}`} value={st.typical} currency={s.currency} placeholder="Typical per month (optional)" onChange={(x) => set({ variable: { ...s.variable, [v.key]: { ...st, typical: x } } })} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {stepName === "Debts" && (
          <Section title="Any debts?" lead="Credit cards, loans, car finance or a student loan. This helps plan repayments — skip if none.">
            <Rows
              items={s.debts}
              onChange={(debts) => set({ debts })}
              blank={{ name: "", kind: "credit_card", balanceOwed: null, rate: "", minimumPayment: null }}
              addLabel="Add a debt"
              render={(d, upd, i) => (
                <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr_0.8fr_1fr]">
                  <Field label="Name" htmlFor={`dn-${i}`}><Input id={`dn-${i}`} value={d.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Visa" /></Field>
                  <Field label="Type" htmlFor={`dk-${i}`}><Select id={`dk-${i}`} value={d.kind} onChange={(e) => upd({ kind: e.target.value as State["debts"][number]["kind"], rate: e.target.value === "student_loan" ? "0" : d.rate })}><option value="credit_card">Credit card</option><option value="personal_loan">Personal loan</option><option value="student_loan">Student loan</option><option value="vehicle">Car finance</option><option value="mortgage">Mortgage</option><option value="other">Other</option></Select></Field>
                  <Field label="Owed" htmlFor={`db-${i}`}><MoneyInput id={`db-${i}`} value={d.balanceOwed} currency={s.currency} onChange={(v) => upd({ balanceOwed: v })} /></Field>
                  <Field label="Rate %" htmlFor={`dr-${i}`}><Input id={`dr-${i}`} value={d.rate} onChange={(e) => upd({ rate: e.target.value })} inputMode="decimal" placeholder="19.95" /></Field>
                  <Field label="Min / month" htmlFor={`dm-${i}`}><MoneyInput id={`dm-${i}`} value={d.minimumPayment} currency={s.currency} onChange={(v) => upd({ minimumPayment: v })} /></Field>
                </div>
              )}
            />
            <p className="mt-3 text-xs text-muted">Not sure of the rate? Enter your best guess — Ledger marks it as an estimate until you confirm it.</p>
          </Section>
        )}

        {stepName === "Goals" && (
          <Section title="What are you saving for?" lead="Goals are earmarks — Ledger tracks progress but never moves your money.">
            <Rows
              items={s.goals}
              onChange={(goals) => set({ goals })}
              blank={{ name: "", kind: "custom", targetAmount: null, targetDate: "", plannedContribution: null, cadence: "fortnightly" }}
              addLabel="Add a goal"
              render={(g, upd, i) => (
                <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr_1fr_1fr]">
                  <Field label="Goal" htmlFor={`gn-${i}`}><Input id={`gn-${i}`} value={g.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Holiday" /></Field>
                  <Field label="Target" htmlFor={`gt-${i}`}><MoneyInput id={`gt-${i}`} value={g.targetAmount} currency={s.currency} onChange={(v) => upd({ targetAmount: v })} /></Field>
                  <Field label="By" htmlFor={`gd-${i}`} optional><Input id={`gd-${i}`} type="date" value={g.targetDate} min={today} onChange={(e) => upd({ targetDate: e.target.value })} /></Field>
                  <Field label={`Save per ${g.cadence === "monthly" ? "month" : g.cadence === "weekly" ? "week" : "fortnight"}`} htmlFor={`gc-${i}`} optional><MoneyInput id={`gc-${i}`} value={g.plannedContribution} currency={s.currency} onChange={(v) => upd({ plannedContribution: v })} /></Field>
                </div>
              )}
            />
          </Section>
        )}

        {stepName === "Budget style" && (
          <Section title="How do you like to budget?" lead="You can switch any time without losing anything.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Choice on={s.budgetMethod === "envelope"} onClick={() => set({ budgetMethod: "envelope" })} title="Envelope (zero-based)" body="Give every dollar a job. Unspent money rolls over; overspending is something you cover. Best for staying in control." />
              <Choice on={s.budgetMethod === "flexible"} onClick={() => set({ budgetMethod: "flexible" })} title="Flexible limits" body="Set a monthly limit for each category and get warned as you approach it. Simpler and lighter-touch." />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Choice on={s.budgetMode === "guided"} onClick={() => set({ budgetMode: "guided" })} title="Suggest a starting budget" body="We’ll draft amounts from your income and bills for you to edit." />
              <Choice on={s.budgetMode === "manual"} onClick={() => set({ budgetMode: "manual" })} title="I’ll set amounts myself" body="Start with an empty budget." />
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Safety buffer" htmlFor="o-buf" hint="Kept aside when we work out what’s safe to spend."><MoneyInput id="o-buf" value={s.safetyBuffer} currency={s.currency} onChange={(v) => set({ safetyBuffer: v })} /></Field>
            </div>
            <p className="mt-6 text-sm font-medium">What matters most right now? <span className="font-normal text-muted">(optional)</span></p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRIORITIES.map((p) => <Chip key={p} on={s.priorities.includes(p)} onClick={() => set({ priorities: s.priorities.includes(p) ? s.priorities.filter((x) => x !== p) : [...s.priorities, p] })}>{p}</Chip>)}
            </div>
          </Section>
        )}

        {stepName === "Review" && (
          <Section title={s.budgetMode === "guided" ? "Your starter budget" : "Ready to go"} lead={s.budgetMode === "guided" ? "Built from your numbers. Change anything — nothing is final, and you can adjust it every month." : "We’ll create your accounts, bills and goals. Set your budget amounts on the Budget page."}>
            {s.budgetMode === "guided" ? (
              <>
                {starter.shortfall > 0 && <Alert tone="warning" className="mb-4">Your commitments are <Money value={starter.shortfall} currency={s.currency} /> more than your monthly income. We haven’t invented money to cover it — look for bills or goals to reduce.</Alert>}
                <div className="mb-3 flex justify-between text-sm"><span className="text-muted">Monthly income (average)</span><Money value={monthlyIncome} currency={s.currency} className="font-medium" /></div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {Object.entries(s.allocations).map(([k, amount]) => (
                    <li key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>{VARIABLE.find((v) => v.key === k)?.label ?? FIXED_PRESETS.find((f) => f.categoryKey === k)?.name ?? (k === "debt_repayments" ? "Debt repayments" : k === "savings" ? "Savings" : k)}</span>
                      <div className="w-36"><label htmlFor={`alloc-${k}`} className="sr-only">Monthly amount</label><MoneyInput id={`alloc-${k}`} value={amount} currency={s.currency} onChange={(v) => set({ allocations: { ...s.allocations, [k]: v ?? 0 } })} /></div>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex justify-between text-sm">
                  <span className="text-muted">Left unassigned</span>
                  <Money value={monthlyIncome - sum(Object.values(s.allocations))} currency={s.currency} className="font-semibold" tone="negative" />
                </div>
                {starter.notes.map((n) => <p key={n} className="mt-3 text-xs text-muted">{n}</p>)}
              </>
            ) : (
              <ul className="space-y-1.5 text-sm text-text-2">
                <li>{s.accounts.filter((a) => a.name).length} account(s)</li>
                <li>{s.incomes.filter((i) => i.amount).length} income source(s)</li>
                <li>{fixedRows.length} bill(s)</li>
                <li>{s.goals.filter((g) => g.targetAmount).length} goal(s), {s.debts.filter((d) => d.balanceOwed !== null).length} debt(s)</li>
              </ul>
            )}
          </Section>
        )}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-5">
          <Button variant="ghost" onClick={() => goTo(Math.max(step - 1, 0))} disabled={step === 0}><ArrowLeft /> Back</Button>
          {step < STEPS.length - 1 ? (
            <div className="flex gap-2">
              {step > 0 && <Button variant="ghost" onClick={() => goTo(step + 1)}>Skip</Button>}
              <Button variant="primary" onClick={() => goTo(step + 1)}>Continue <ArrowRight /></Button>
            </div>
          ) : (
            <Button variant="primary" onClick={finish} loading={saving}><Check /> Finish setup</Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function Section({ title, lead, children }: { title: string; lead: string; children: React.ReactNode }) {
  return (
    <section>
      <h1 className="font-display text-3xl tracking-tight sm:text-4xl">{title}</h1>
      <p className="mb-6 mt-2 text-sm text-muted">{lead}</p>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={cn("rounded-full border px-3.5 py-1.5 text-sm transition-colors", on ? "border-accent bg-accent-soft text-accent" : "border-border hover:border-border-strong")}>
      {children}
    </button>
  );
}

function Choice({ on, onClick, title, body }: { on: boolean; onClick: () => void; title: string; body: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={cn("rounded-xl border p-4 text-left transition-colors", on ? "border-accent bg-accent-soft/40 ring-1 ring-accent" : "border-border hover:border-border-strong")}>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-[13px] text-muted">{body}</p>
    </button>
  );
}

function Rows<T>({ items, onChange, blank, render, addLabel }: { items: T[]; onChange: (v: T[]) => void; blank: T; render: (item: T, update: (patch: Partial<T>) => void, index: number) => React.ReactNode; addLabel: string }) {
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="relative rounded-lg border border-border p-3 pr-11">
          {render(it, (patch) => onChange(items.map((x, j) => (j === i ? { ...x, ...patch } : x))), i)}
          <button type="button" className="absolute right-2 top-2 rounded p-1.5 text-muted hover:bg-surface-2 hover:text-negative" aria-label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange([...items, blank])}><Plus /> {addLabel}</Button>
    </div>
  );
}
