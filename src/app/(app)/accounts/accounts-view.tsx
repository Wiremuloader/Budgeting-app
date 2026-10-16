"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Banknote, CheckCheck, CreditCard, Landmark, MoreHorizontal, Pencil, PiggyBank, Plus, Scale, Trash2, Upload, Wallet, Link2Off } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, Select } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Money, MoneyInput } from "@/components/money";
import { adjustBalanceAction, archiveAccountAction, createAccountAction, deleteAccountAction, reconcileAction, updateAccountAction } from "@/server/actions/finance";
import type { Totals } from "@/domain/ledger";
import { formatDisplayDate } from "@/domain/dates";
import { formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";

interface AccountRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  institution: string | null;
  mask: string | null;
  spendable: boolean;
  includeInNetWorth: boolean;
  onBudget: boolean;
  archived: boolean;
  balance: number;
  clearedBalance: number;
  pendingBalance: number;
  transactionCount: number;
  lastTransactionDate: string | null;
  lastReconciledAt: string | null;
  isSample: boolean;
  hasDebtProfile: boolean;
  connected: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  checking: "Everyday",
  savings: "Savings",
  cash: "Cash",
  credit_card: "Credit card",
  loan: "Loan",
  investment: "Investment",
  other_asset: "Other asset",
  other_liability: "Other liability",
};

const GROUPS: { key: string; label: string; types: string[]; icon: React.ReactNode }[] = [
  { key: "cash", label: "Bank & cash", types: ["checking", "savings", "cash"], icon: <Wallet /> },
  { key: "credit", label: "Credit cards", types: ["credit_card"], icon: <CreditCard /> },
  { key: "loans", label: "Loans & other debts", types: ["loan", "other_liability"], icon: <Landmark /> },
  { key: "assets", label: "Investments & other assets", types: ["investment", "other_asset"], icon: <PiggyBank /> },
];

const isLiability = (t: string) => ["credit_card", "loan", "other_liability"].includes(t);

export function AccountsView({
  accounts,
  totals,
  currency,
  today,
  openNew,
  providers,
}: {
  accounts: AccountRow[];
  totals: Totals;
  currency: string;
  today: string;
  openNew: boolean;
  providers: { id: string; name: string }[];
}) {
  const [creating, setCreating] = React.useState(openNew);
  const [editing, setEditing] = React.useState<AccountRow | null>(null);
  const [adjusting, setAdjusting] = React.useState<AccountRow | null>(null);
  const [reconciling, setReconciling] = React.useState<AccountRow | null>(null);
  const [deleting, setDeleting] = React.useState<AccountRow | null>(null);
  const [showArchived, setShowArchived] = React.useState(false);
  const router = useRouter();

  const visible = accounts.filter((a) => showArchived || !a.archived);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Balances are calculated from your transactions, so every figure can be traced."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus /> Add account
          </Button>
        }
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-3" aria-label="Totals">
        <Card className="p-4">
          <p className="text-[13px] text-muted">Cash (bank & cash accounts)</p>
          <p className="mt-1 text-2xl font-semibold"><Money value={totals.cash} currency={currency} /></p>
        </Card>
        <Card className="p-4">
          <p className="text-[13px] text-muted">Owed (cards & loans)</p>
          <p className="mt-1 text-2xl font-semibold"><Money value={totals.liabilities} currency={currency} /></p>
        </Card>
        <Card className="p-4">
          <p className="text-[13px] text-muted">Net worth</p>
          <p className="mt-1 text-2xl font-semibold"><Money value={totals.netWorth} currency={currency} tone="negative" /></p>
          <p className="text-xs text-muted">Assets <Money value={totals.assets} currency={currency} /> − liabilities <Money value={totals.liabilities} currency={currency} /></p>
        </Card>
      </section>

      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon={<Landmark />} title="No accounts yet" action={<Button variant="primary" onClick={() => setCreating(true)}>Add your first account</Button>}>
            Add the accounts you want to track — everyday, savings, credit cards, loans or cash.
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-5">
          {GROUPS.map((g) => {
            const rows = visible.filter((a) => g.types.includes(a.type));
            if (!rows.length) return null;
            const groupTotal = rows.filter((a) => !a.archived && a.currency === currency).reduce((s, a) => s + a.balance, 0);
            return (
              <Card key={g.key}>
                <CardHeader
                  title={<span className="flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted">{g.icon}{g.label}</span>}
                  action={<Money value={groupTotal} currency={currency} className="text-sm font-semibold" tone="negative" />}
                />
                <ul className="mt-3 divide-y divide-border border-t border-border">
                  {rows.map((a) => (
                    <li key={a.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5", a.archived && "opacity-60")}>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <Link href={`/transactions?account=${a.id}`} className="hover:underline">{a.name}</Link>
                          {a.mask && <span className="num text-xs text-muted">••{a.mask}</span>}
                          {a.isSample && <Badge tone="warning">Sample</Badge>}
                          {a.archived && <Badge tone="outline">Archived</Badge>}
                          {a.spendable && <Badge tone="accent">Spendable</Badge>}
                          {!a.includeInNetWorth && <Badge>Excluded from net worth</Badge>}
                          {!a.connected && !a.isSample && <span className="text-[11px] text-muted">Manual</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {[a.institution, TYPE_LABELS[a.type], a.currency !== currency ? a.currency : null, a.lastTransactionDate ? `Last activity ${formatDisplayDate(a.lastTransactionDate)}` : "No transactions yet", a.lastReconciledAt ? `Reconciled ${new Date(a.lastReconciledAt).toLocaleDateString("en-NZ")}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-base font-semibold">
                          {isLiability(a.type) && a.balance < 0 ? (
                            <>
                              <Money value={-a.balance} currency={a.currency} /> <span className="text-xs font-normal text-muted">owed</span>
                            </>
                          ) : (
                            <Money value={a.balance} currency={a.currency} tone="negative" />
                          )}
                        </p>
                        {a.pendingBalance !== 0 && (
                          <p className="text-[11px] text-muted">
                            Cleared {formatMoney(a.clearedBalance, a.currency)} · pending {formatMoney(a.pendingBalance, a.currency, { signed: true })}
                          </p>
                        )}
                      </div>
                      <Menu>
                        <MenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${a.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem icon={<Banknote />} onSelect={() => router.push(`/transactions?account=${a.id}`)}>View transactions</MenuItem>
                          <MenuItem icon={<Upload />} onSelect={() => router.push(`/transactions/import?account=${a.id}`)} disabled={a.archived}>Import CSV</MenuItem>
                          <MenuItem icon={<Pencil />} onSelect={() => setEditing(a)}>Edit details</MenuItem>
                          <MenuItem icon={<Scale />} onSelect={() => setAdjusting(a)} disabled={a.archived}>Adjust balance</MenuItem>
                          <MenuItem icon={<CheckCheck />} onSelect={() => setReconciling(a)} disabled={a.archived}>Reconcile with statement</MenuItem>
                          <MenuSeparator />
                          <MenuItem
                            icon={a.archived ? <ArchiveRestore /> : <Archive />}
                            onSelect={async () => {
                              const r = await archiveAccountAction({ id: a.id, archived: !a.archived });
                              if (!r.ok) return toast.error(r.error);
                              toast.success(a.archived ? "Account restored" : "Account archived — its history stays in your reports");
                              router.refresh();
                            }}
                          >
                            {a.archived ? "Restore" : "Archive"}
                          </MenuItem>
                          <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(a)}>Delete</MenuItem>
                        </MenuContent>
                      </Menu>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          {accounts.some((a) => a.archived) && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived accounts
            </label>
          )}
          {totals.excludedAccountIds.length > 0 && <Alert tone="info">Accounts in other currencies are shown but not added to your {currency} totals. Ledger doesn’t convert currencies.</Alert>}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader title="Bank connections" description="Automatic syncing with your bank" />
        <CardBody>
          {providers.length === 0 ? (
            <div className="flex flex-wrap items-start gap-3 text-sm text-text-2">
              <Link2Off className="mt-0.5 size-4 shrink-0 text-muted" />
              <div className="flex-1">
                <p>
                  Live bank sync isn’t available on this server yet. Connecting to NZ banks requires an approved open-banking provider, and Ledger will never ask for your internet banking password.
                </p>
                <p className="mt-1 text-muted">In the meantime, import CSV exports from your bank — re-importing never creates duplicates.</p>
              </div>
              <Link href="/transactions/import" className="text-sm font-medium text-accent hover:underline">Import CSV</Link>
            </div>
          ) : (
            <p className="text-sm">Available providers: {providers.map((p) => p.name).join(", ")}</p>
          )}
        </CardBody>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="Add an account" description="Enter the balance shown by your bank today. Ledger tracks changes from there.">
          <CreateAccountForm currency={currency} today={today} onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <DialogContent title={`Edit ${editing.name}`}>
            <EditAccountForm account={editing} onDone={() => setEditing(null)} />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={!!adjusting} onOpenChange={(o) => !o && setAdjusting(null)}>
        {adjusting && (
          <DialogContent title="Adjust balance" description="Records the difference as a balance adjustment. Adjustments are never counted as income or spending." size="sm">
            <AdjustForm account={adjusting} today={today} onDone={() => setAdjusting(null)} />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={!!reconciling} onOpenChange={(o) => !o && setReconciling(null)}>
        {reconciling && (
          <DialogContent title="Reconcile with a statement" description="Compare Ledger’s cleared balance with your bank statement. When they match, those transactions are locked as reconciled." size="sm">
            <ReconcileForm account={reconciling} today={today} onDone={() => setReconciling(null)} onAdjust={() => { setAdjusting(reconciling); setReconciling(null); }} />
          </DialogContent>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description={deleting && deleting.transactionCount > 1 ? "This account has transactions, so it can only be archived. Archiving keeps your history accurate." : "This removes the account and its opening balance."}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          const r = await deleteAccountAction({ id: deleting!.id });
          setDeleting(null);
          if (!r.ok) return toast.error(r.error);
          toast.success("Account deleted");
          router.refresh();
        }}
      />
    </>
  );
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the account a name").max(60),
  type: z.enum(["checking", "savings", "cash", "credit_card", "loan", "investment", "other_asset", "other_liability"]),
  institution: z.string().max(60).optional(),
  mask: z.string().regex(/^(\d{2,4})?$/, "Last 2–4 digits only").optional(),
  balance: z.number({ message: "Enter the current balance" }).int(),
  openingDate: z.string().min(10),
  spendable: z.boolean(),
  includeInNetWorth: z.boolean(),
});
type CreateValues = z.infer<typeof createSchema>;

function CreateAccountForm({ currency, today, onDone }: { currency: string; today: string; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const { register, handleSubmit, control, setValue, formState } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", type: "checking", institution: "", mask: "", balance: 0, openingDate: today, spendable: true, includeInNetWorth: true },
  });
  const type = useWatch({ control, name: "type" });
  const liability = isLiability(type);

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setError(null);
        const r = await createAccountAction({
          name: v.name,
          type: v.type,
          currency,
          institution: v.institution || null,
          mask: v.mask || null,
          // Liabilities: the user enters the amount owed; the ledger stores it as a negative balance.
          openingBalance: liability ? -Math.abs(v.balance) : v.balance,
          openingDate: v.openingDate,
          spendable: v.spendable,
          includeInNetWorth: v.includeInNetWorth,
        });
        if (!r.ok) return setError(r.error);
        toast.success("Account added");
        router.refresh();
        onDone();
      })}
    >
      {error && <Alert tone="negative">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Account name" htmlFor="acc-name" error={formState.errors.name?.message}>
          <Input id="acc-name" placeholder="e.g. Kiwibank Everyday" {...register("name")} aria-invalid={!!formState.errors.name} autoFocus />
        </Field>
        <Field label="Type" htmlFor="acc-type">
          <Select
            id="acc-type"
            {...register("type", {
              onChange: (e) => setValue("spendable", ["checking", "cash"].includes(e.target.value)),
            })}
          >
            {Object.entries(TYPE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Bank or provider" htmlFor="acc-inst" optional>
          <Input id="acc-inst" placeholder="e.g. ANZ" {...register("institution")} />
        </Field>
        <Field label="Last digits" htmlFor="acc-mask" optional hint="Helps you recognise it. Never enter a full account number." error={formState.errors.mask?.message}>
          <Input id="acc-mask" inputMode="numeric" maxLength={4} {...register("mask")} />
        </Field>
        <Field label={liability ? "Amount currently owed" : "Current balance"} htmlFor="acc-bal" error={formState.errors.balance?.message} hint={liability ? "Enter a positive number." : "Use a minus sign if overdrawn."}>
          <Controller control={control} name="balance" render={({ field }) => <MoneyInput id="acc-bal" value={field.value} currency={currency} allowNegative={!liability} onChange={(v) => field.onChange(v ?? 0)} />} />
        </Field>
        <Field label="Balance as of" htmlFor="acc-date">
          <Input id="acc-date" type="date" {...register("openingDate")} max={today} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox {...register("spendable")} /> Spendable — count this money in “safe to spend” and forecasts
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox {...register("includeInNetWorth")} /> Include in net worth
      </label>
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={formState.isSubmitting}>Add account</Button>
      </DialogFooter>
    </form>
  );
}

function EditAccountForm({ account, onDone }: { account: AccountRow; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = React.useState(account.name);
  const [institution, setInstitution] = React.useState(account.institution ?? "");
  const [mask, setMask] = React.useState(account.mask ?? "");
  const [spendable, setSpendable] = React.useState(account.spendable);
  const [nw, setNw] = React.useState(account.includeInNetWorth);
  const [onBudget, setOnBudget] = React.useState(account.onBudget);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const r = await updateAccountAction({ id: account.id, name, institution: institution || null, mask, spendable, includeInNetWorth: nw, onBudget });
        setSaving(false);
        if (!r.ok) return setError(r.error);
        toast.success("Saved");
        router.refresh();
        onDone();
      }}
    >
      {error && <Alert tone="negative">{error}</Alert>}
      <Field label="Name" htmlFor="ea-name"><Input id="ea-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bank or provider" htmlFor="ea-inst" optional><Input id="ea-inst" value={institution} onChange={(e) => setInstitution(e.target.value)} /></Field>
        <Field label="Last digits" htmlFor="ea-mask" optional><Input id="ea-mask" value={mask} onChange={(e) => setMask(e.target.value)} maxLength={4} inputMode="numeric" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={spendable} onChange={(e) => setSpendable(e.target.checked)} /> Spendable (counts toward safe to spend)</label>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={nw} onChange={(e) => setNw(e.target.checked)} /> Include in net worth</label>
      {["checking", "savings", "cash"].includes(account.type) && (
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={onBudget} onChange={(e) => setOnBudget(e.target.checked)} /> Part of my envelope budget</label>
      )}
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>Save</Button>
      </DialogFooter>
    </form>
  );
}

function AdjustForm({ account, today, onDone }: { account: AccountRow; today: string; onDone: () => void }) {
  const router = useRouter();
  const liability = isLiability(account.type);
  const [value, setValue] = React.useState<number | null>(liability ? -account.balance : account.balance);
  const [date, setDate] = React.useState(today);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const target = value === null ? null : liability ? -value : value;
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (target === null) return setError("Enter the correct balance");
        setSaving(true);
        const r = await adjustBalanceAction({ id: account.id, newBalance: target, date, reason });
        setSaving(false);
        if (!r.ok) return setError(r.error);
        toast.success(r.data.difference === 0 ? "Balance already matches" : `Adjusted by ${formatMoney(r.data.difference, account.currency, { signed: true })}`);
        router.refresh();
        onDone();
      }}
    >
      {error && <Alert tone="negative">{error}</Alert>}
      <p className="text-sm text-muted">Ledger currently shows <Money value={liability ? -account.balance : account.balance} currency={account.currency} className="font-medium text-text" />{liability ? " owed" : ""}.</p>
      <Field label={liability ? "Correct amount owed" : "Correct balance"} htmlFor="adj-val">
        <MoneyInput id="adj-val" value={value} currency={account.currency} allowNegative onChange={(v) => setValue(v)} />
      </Field>
      <Field label="As of" htmlFor="adj-date"><Input id="adj-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Reason" htmlFor="adj-reason" hint="Kept in the account’s history.">
        <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bank charged a fee I didn't record" maxLength={200} />
      </Field>
      {target !== null && target !== account.balance && (
        <p className="text-sm">Adjustment: <Money value={target - account.balance} currency={account.currency} signed className="font-medium" /></p>
      )}
      <DialogFooter>
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>Record adjustment</Button>
      </DialogFooter>
    </form>
  );
}

function ReconcileForm({ account, today, onDone, onAdjust }: { account: AccountRow; today: string; onDone: () => void; onAdjust: () => void }) {
  const router = useRouter();
  const liability = isLiability(account.type);
  const [value, setValue] = React.useState<number | null>(null);
  const [date, setDate] = React.useState(today);
  const [result, setResult] = React.useState<{ balanced: boolean; difference: number; reconciledCount: number } | null>(null);
  const [saving, setSaving] = React.useState(false);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (value === null) return;
        setSaving(true);
        const r = await reconcileAction({ id: account.id, statementBalance: liability ? -value : value, statementDate: date });
        setSaving(false);
        if (!r.ok) return toast.error(r.error);
        setResult(r.data);
        if (r.data.balanced) {
          toast.success(`Reconciled ${r.data.reconciledCount} transactions`);
          router.refresh();
        }
      }}
    >
      <Field label="Statement date" htmlFor="rec-date"><Input id="rec-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label={liability ? "Statement amount owed" : "Statement closing balance"} htmlFor="rec-val">
        <MoneyInput id="rec-val" value={value} currency={account.currency} allowNegative onChange={(v) => setValue(v)} />
      </Field>
      {result && !result.balanced && (
        <Alert tone="warning" title={`Out by ${formatMoney(Math.abs(result.difference), account.currency)}`} action={<Button size="sm" onClick={onAdjust}>Adjust balance</Button>}>
          Look for missing, duplicated or still-pending transactions up to {formatDisplayDate(date)}. If you can’t find it, record an adjustment.
        </Alert>
      )}
      {result?.balanced && <Alert tone="positive">Balanced. {result.reconciledCount} transactions are now locked as reconciled.</Alert>}
      <DialogFooter>
        <Button onClick={onDone}>{result?.balanced ? "Done" : "Cancel"}</Button>
        {!result?.balanced && <Button type="submit" variant="primary" loading={saving} disabled={value === null}>Check</Button>}
      </DialogFooter>
    </form>
  );
}
