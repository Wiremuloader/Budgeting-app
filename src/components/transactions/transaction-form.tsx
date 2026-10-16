"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Split, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { DialogFooter } from "@/components/ui/overlay";
import { Money, MoneyInput } from "@/components/money";
import { createTransactionAction, createTransferAction, suggestCategoryAction, updateTransactionAction } from "@/server/actions/finance";
import type { EditableTransaction, PickerData } from "./types";

type Mode = "expense" | "income" | "transfer";

interface SplitRow {
  key: number;
  categoryId: string;
  amount: number | null;
}

export function CategoryOptions({ pickers, group }: { pickers: PickerData; group?: "income" | "expense" }) {
  const groups = group ? [group] : (["expense", "income"] as const);
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g} label={g === "income" ? "Income" : "Spending"}>
          {pickers.categories
            .filter((c) => c.group === g)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? "  ↳ " : ""}
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

export function TransactionForm({
  pickers,
  initial,
  defaultAccountId,
  onDone,
}: {
  pickers: PickerData;
  initial?: EditableTransaction;
  defaultAccountId?: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const editing = Boolean(initial);
  const initialCat = initial?.categoryId ? pickers.categories.find((c) => c.id === initial.categoryId) : null;
  const [mode, setMode] = React.useState<Mode>(
    initial?.kind === "transfer" ? "transfer" : initialCat?.group === "income" || (initial && !initialCat && initial.amount > 0 && !initial.splits.length) ? "income" : "expense",
  );
  const spendable = pickers.accounts.find((a) => a.type === "checking") ?? pickers.accounts[0];
  const [accountId, setAccountId] = React.useState(initial?.accountId ?? defaultAccountId ?? spendable?.id ?? "");
  const [toAccountId, setToAccountId] = React.useState(initial?.transferCounterpart?.accountId ?? pickers.accounts.find((a) => a.id !== (defaultAccountId ?? spendable?.id))?.id ?? "");
  const [amount, setAmount] = React.useState<number | null>(initial ? Math.abs(initial.amount) : null);
  const [amountError, setAmountError] = React.useState<string | null>(null);
  const [isRefund, setIsRefund] = React.useState(Boolean(initial && initial.kind === "standard" && initialCat?.group === "expense" && initial.amount > 0));
  const [merchant, setMerchant] = React.useState(initial?.merchant ?? "");
  const [categoryId, setCategoryId] = React.useState(initial?.categoryId ?? "");
  const [categoryTouched, setCategoryTouched] = React.useState(Boolean(initial));
  const [date, setDate] = React.useState(initial?.date ?? pickers.today);
  const [pending, setPending] = React.useState(initial?.status === "pending");
  const [notes, setNotes] = React.useState(initial?.notes ?? "");
  const [tags, setTags] = React.useState(initial?.tags.join(", ") ?? "");
  const [splitting, setSplitting] = React.useState(Boolean(initial?.splits.length));
  const [splits, setSplits] = React.useState<SplitRow[]>(
    initial?.splits.length
      ? initial.splits.map((s, i) => ({ key: i, categoryId: s.categoryId, amount: Math.abs(s.amount) }))
      : [
          { key: 0, categoryId: "", amount: null },
          { key: 1, categoryId: "", amount: null },
        ],
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const reconciled = initial?.status === "reconciled";
  const currency = pickers.accounts.find((a) => a.id === accountId)?.currency ?? pickers.currency;

  const splitTotal = splits.reduce((s, r) => s + (r.amount ?? 0), 0);
  const splitRemaining = (amount ?? 0) - splitTotal;
  const toAccount = pickers.accounts.find((a) => a.id === toAccountId);
  const transferNeedsCategory = toAccount && ["loan", "other_liability", "investment", "other_asset"].includes(toAccount.type);

  async function suggest() {
    if (categoryTouched || !merchant.trim() || editing) return;
    const r = await suggestCategoryAction({ merchant });
    if (r.ok && r.data.categoryId) {
      const c = pickers.categories.find((x) => x.id === r.data.categoryId);
      if (c) {
        setCategoryId(c.id);
        if (c.group === "income") setMode("income");
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!amount || amount <= 0) return setAmountError(amountError ?? "Enter an amount");
    setSaving(true);
    try {
      if (mode === "transfer") {
        if (accountId === toAccountId) throw new Error("Choose two different accounts");
        const r = editing
          ? await updateTransactionAction({
              id: initial!.id,
              amount: initial!.amount < 0 ? -amount : amount,
              date,
              notes: notes || null,
              status: pending ? "pending" : "cleared",
              expectedUpdatedAt: initial!.updatedAt,
            })
          : await createTransferAction({ fromAccountId: accountId, toAccountId, amount, date, notes: notes || null, categoryId: categoryId || null, status: pending ? "pending" : "cleared" });
        if (!r.ok) throw new Error(r.error);
      } else {
        const sign = mode === "income" ? 1 : isRefund ? 1 : -1;
        const signed = sign * amount;
        if (splitting) {
          if (splits.some((s) => !s.categoryId || !s.amount)) throw new Error("Each split needs a category and amount");
          if (splitRemaining !== 0) throw new Error("Split amounts must add up to the total");
        }
        const payload = {
          accountId,
          date,
          amount: signed,
          merchant: merchant.trim(),
          notes: notes.trim() || null,
          categoryId: splitting ? null : categoryId || null,
          status: pending ? ("pending" as const) : ("cleared" as const),
          tags: tags
            .split(/[,\s]+/)
            .map((t) => t.trim())
            .filter(Boolean),
          splits: splitting ? splits.map((s) => ({ categoryId: s.categoryId, amount: sign * (s.amount ?? 0) })) : null,
        };
        const r = editing
          ? await updateTransactionAction({ id: initial!.id, ...payload, ...(reconciled ? { amount: undefined, date: undefined, accountId: undefined } : {}), expectedUpdatedAt: initial!.updatedAt })
          : await createTransactionAction(payload);
        if (!r.ok) throw new Error(r.error);
      }
      toast.success(editing ? "Transaction updated" : mode === "transfer" ? "Transfer recorded" : "Transaction added");
      router.refresh();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const modeButton = (m: Mode, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      disabled={editing && (m === "transfer") !== (initial?.kind === "transfer")}
      onClick={() => {
        setMode(m);
        if (m !== "expense") setIsRefund(false);
        if (!categoryTouched) setCategoryId("");
      }}
      className={cn(
        "h-8 flex-1 rounded-md text-sm font-medium transition-colors disabled:opacity-40",
        mode === m ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
      )}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div role="radiogroup" aria-label="Transaction type" className="flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
        {modeButton("expense", "Expense")}
        {modeButton("income", "Income")}
        {modeButton("transfer", "Transfer")}
      </div>
      {error && <Alert tone="negative">{error}</Alert>}
      {reconciled && <Alert tone="info">This transaction is reconciled, so its amount, date and account are locked.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount" htmlFor="tx-amount" error={amountError}>
          <MoneyInput id="tx-amount" value={amount} currency={currency} autoFocus={!editing} invalid={!!amountError} onChange={(v, err) => { setAmount(v); setAmountError(err); }} required />
        </Field>
        <Field label="Date" htmlFor="tx-date">
          <Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required disabled={reconciled} />
        </Field>
      </div>

      {mode === "transfer" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="From" htmlFor="tx-from">
              <Select id="tx-from" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={editing}>
                {pickers.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="To" htmlFor="tx-to">
              <Select id="tx-to" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} disabled={editing}>
                {pickers.accounts
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          {!editing && transferNeedsCategory && (
            <Field label="Budget category" htmlFor="tx-tcat" optional hint="Use this for loan repayments or money leaving your budget. Transfers never count as spending in reports.">
              <Select id="tx-tcat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">None</option>
                <CategoryOptions pickers={pickers} group="expense" />
              </Select>
            </Field>
          )}
          <p className="-mt-1 text-xs text-muted">Transfers between your own accounts aren’t income or spending. Paying a credit card is a transfer: the purchases were already counted.</p>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={mode === "income" ? "From (payer)" : "Payee"} htmlFor="tx-merchant">
              <Input id="tx-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} onBlur={suggest} placeholder={mode === "income" ? "Employer" : "e.g. Countdown"} required autoComplete="off" />
            </Field>
            <Field label="Account" htmlFor="tx-account">
              <Select id="tx-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={reconciled}>
                {pickers.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {!splitting ? (
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
              <Field label="Category" htmlFor="tx-category">
                <Select
                  id="tx-category"
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    setCategoryTouched(true);
                  }}
                >
                  <option value="">Uncategorised</option>
                  <CategoryOptions pickers={pickers} group={mode === "income" ? "income" : "expense"} />
                </Select>
              </Field>
              {mode === "expense" && (
                <Button variant="ghost" onClick={() => setSplitting(true)}>
                  <Split /> Split
                </Button>
              )}
            </div>
          ) : (
            <fieldset className="rounded-lg border border-border p-3">
              <legend className="px-1 text-[13px] font-medium text-text-2">Split across categories</legend>
              <div className="grid gap-2">
                {splits.map((row, i) => (
                  <div key={row.key} className="grid grid-cols-[1fr_8rem_auto] gap-2">
                    <Select
                      aria-label={`Split ${i + 1} category`}
                      value={row.categoryId}
                      onChange={(e) => setSplits((xs) => xs.map((x) => (x.key === row.key ? { ...x, categoryId: e.target.value } : x)))}
                    >
                      <option value="">Choose…</option>
                      <CategoryOptions pickers={pickers} group="expense" />
                    </Select>
                    <MoneyInput value={row.amount} currency={currency} onChange={(v) => setSplits((xs) => xs.map((x) => (x.key === row.key ? { ...x, amount: v } : x)))} aria-describedby="split-remaining" />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove split ${i + 1}`}
                      disabled={splits.length <= 2}
                      onClick={() => setSplits((xs) => xs.filter((x) => x.key !== row.key))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setSplits((xs) => [...xs, { key: Date.now(), categoryId: "", amount: null }])}>
                    <Plus /> Add part
                  </Button>
                  {splitRemaining > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const last = splits.findLast((s) => !s.amount) ?? splits[splits.length - 1];
                        setSplits((xs) => xs.map((x) => (x.key === last.key ? { ...x, amount: (x.amount ?? 0) + splitRemaining } : x)));
                      }}
                    >
                      Fill remainder
                    </Button>
                  )}
                  {!editing && (
                    <Button size="sm" variant="ghost" onClick={() => setSplitting(false)}>
                      Cancel split
                    </Button>
                  )}
                </div>
                <p id="split-remaining" className={cn("num", splitRemaining === 0 ? "text-positive" : "text-warning")} aria-live="polite">
                  {splitRemaining === 0 ? "Balanced" : <>Remaining <Money value={splitRemaining} currency={currency} /></>}
                </p>
              </div>
            </fieldset>
          )}

          {mode === "expense" && !splitting && (
            <label className="flex items-center gap-2 text-sm text-text-2">
              <Checkbox checked={isRefund} onChange={(e) => setIsRefund(e.target.checked)} />
              This is a refund (money back into the category)
            </label>
          )}
        </>
      )}

      <Field label="Notes" htmlFor="tx-notes" optional>
        <Textarea id="tx-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} />
      </Field>
      {mode !== "transfer" && (
        <Field label="Tags" htmlFor="tx-tags" optional hint="Separate with commas, e.g. holiday, work">
          <Input id="tx-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      )}
      {!reconciled && (
        <label className="flex items-center gap-2 text-sm text-text-2">
          <Checkbox checked={pending} onChange={(e) => setPending(e.target.checked)} />
          Pending (not yet cleared by the bank)
        </label>
      )}

      <DialogFooter>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {editing ? "Save changes" : mode === "transfer" ? "Record transfer" : "Add transaction"}
        </Button>
      </DialogFooter>
    </form>
  );
}
