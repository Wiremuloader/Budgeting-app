"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDownUp,
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Link2,
  MoreHorizontal,
  Pencil,
  Receipt,
  Search,
  SlidersHorizontal,
  Split,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Input, Select } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog, DialogContent, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Money } from "@/components/money";
import { useQuickAdd } from "@/components/transactions/quick-add";
import { CategoryOptions } from "@/components/transactions/transaction-form";
import { bulkDeleteAction, bulkUpdateAction, deleteTransactionAction, linkTransferAction, transactionHistoryAction, unlinkTransferAction, updateTransactionAction } from "@/server/actions/finance";
import type { TransactionFilters, TransactionListItem } from "@/server/services/transactions";
import type { TransferCandidate } from "@/server/services/imports";
import { formatDisplayDate } from "@/domain/dates";
import { formatMoney } from "@/domain/money";

type Item = Omit<TransactionListItem, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

interface Props {
  currency: string;
  filters: TransactionFilters;
  result: { items: Item[]; page: number; pages: number; total: number; inflow: number; outflow: number };
  candidates: TransferCandidate[];
}

function useParamNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in patch)) next.delete("page");
      const s = next.toString();
      router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
}

function categoryLabel(t: Item) {
  if (t.kind === "transfer") return t.transferCounterpart ? `${t.amount < 0 ? "To" : "From"} ${t.transferCounterpart.accountName}` : "Transfer";
  if (t.kind === "adjustment") return "Balance adjustment";
  if (t.isSplit) return `Split · ${t.splits.length} categories`;
  return t.categoryName ?? "Uncategorised";
}

export function TransactionsView({ currency, filters, result, candidates }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const nav = useParamNav();
  const { open, pickers } = useQuickAdd();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [q, setQ] = React.useState(filters.q ?? "");
  const [showFilters, setShowFilters] = React.useState(Boolean(filters.from || filters.to || filters.status || filters.reviewed !== undefined || filters.minAmount || filters.maxAmount));
  const [confirmDelete, setConfirmDelete] = React.useState<{ ids: string[]; label: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<{ title: string; rows: { id: string; action: string; source: string; changes: unknown; createdAt: string }[] } | null>(null);

  // Clear the selection whenever a new page of results arrives (state derived during render).
  const [seenResult, setSeenResult] = React.useState(result);
  if (seenResult !== result) {
    setSeenResult(result);
    setSelected(new Set());
  }
  React.useEffect(() => {
    const id = setTimeout(() => {
      if ((filters.q ?? "") !== q) nav({ q: q || null });
    }, 350);
    return () => clearTimeout(id);
  }, [q, filters.q, nav]);

  const allSelected = result.items.length > 0 && result.items.every((t) => selected.has(t.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function edit(t: Item) {
    if (t.kind === "adjustment") {
      toast.info("Balance adjustments can be removed and re-entered from Accounts.");
      return;
    }
    open({
      edit: {
        id: t.id,
        accountId: t.accountId,
        date: t.date,
        time: t.time,
        amount: t.amount,
        merchant: t.merchant,
        notes: t.notes,
        categoryId: t.categoryId,
        status: t.status,
        tags: t.tags,
        kind: t.kind,
        splits: t.splits,
        transferCounterpart: t.transferCounterpart,
        updatedAt: t.updatedAt,
      },
    });
  }

  async function bulk(patch: Parameters<typeof bulkUpdateAction>[0] extends infer P ? Omit<P & object, "ids"> : never, label: string) {
    setBusy(true);
    const r = await bulkUpdateAction({ ids: [...selected], ...patch });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`${label}: ${r.data.updated} updated${r.data.skipped ? `, ${r.data.skipped} skipped (transfers, splits or reconciled)` : ""}`);
    router.refresh();
  }

  async function doDelete() {
    if (!confirmDelete) return;
    setBusy(true);
    const r = confirmDelete.ids.length === 1 ? await deleteTransactionAction({ id: confirmDelete.ids[0] }) : await bulkDeleteAction({ ids: confirmDelete.ids });
    setBusy(false);
    setConfirmDelete(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Deleted");
    router.refresh();
  }

  async function showHistory(t: Item) {
    const r = await transactionHistoryAction({ id: t.id });
    if (!r.ok) return toast.error(r.error);
    setHistory({ title: t.merchant, rows: r.data });
  }

  const sort = filters.sort ?? "date_desc";
  const activeFilterCount = [filters.accountId, filters.categoryId, filters.type, filters.from, filters.to, filters.status, filters.reviewed !== undefined ? "x" : undefined, filters.minAmount, filters.maxAmount, filters.tag].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {candidates.length > 0 && (
        <Alert tone="warning" icon={<ArrowLeftRight />} title="Possible transfers between your accounts">
          <p>These look like the same money leaving one account and arriving in another. Linking them stops a card payment or savings move counting as spending.</p>
          <ul className="mt-2 space-y-1.5">
            {candidates.map((c) => (
              <li key={c.outflow.id} className="flex flex-wrap items-center gap-2">
                <span className="num">{formatMoney(-c.outflow.amount, currency)}</span>
                <span className="text-muted">
                  {c.outflow.accountName} → {c.inflow.accountName}, {formatDisplayDate(c.outflow.date)}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const r = await linkTransferAction({ a: c.outflow.id, b: c.inflow.id });
                    if (!r.ok) return toast.error(r.error);
                    toast.success("Linked as a transfer");
                    router.refresh();
                  }}
                >
                  <Link2 /> Link as transfer
                </Button>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Search payee, description or notes" placeholder="Search payee, description or notes" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
          <Select aria-label="Account" className="w-auto min-w-36" value={filters.accountId ?? ""} onChange={(e) => nav({ account: e.target.value })}>
            <option value="">All accounts</option>
            {pickers.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Category" className="w-auto min-w-40" value={filters.categoryId ?? ""} onChange={(e) => nav({ category: e.target.value })}>
            <option value="">All categories</option>
            <option value="none">Uncategorised</option>
            <CategoryOptions pickers={pickers} />
          </Select>
          <Select aria-label="Type" className="w-auto" value={filters.type ?? ""} onChange={(e) => nav({ type: e.target.value })}>
            <option value="">All types</option>
            <option value="expense">Expenses</option>
            <option value="income">Income</option>
            <option value="refund">Refunds</option>
            <option value="transfer">Transfers</option>
            <option value="adjustment">Adjustments</option>
            <option value="uncategorised">Needs a category</option>
          </Select>
          <Button variant={showFilters ? "secondary" : "ghost"} size="md" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <SlidersHorizontal /> More
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="ghost" onClick={() => { setQ(""); router.push("/transactions"); }}>
              <X /> Clear
            </Button>
          )}
        </div>
        {showFilters && (
          <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="grid gap-1 text-xs text-muted">
              From
              <Input type="date" value={filters.from ?? ""} onChange={(e) => nav({ from: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              To
              <Input type="date" value={filters.to ?? ""} onChange={(e) => nav({ to: e.target.value })} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Min amount
              <Input inputMode="decimal" defaultValue={params.get("min") ?? ""} onBlur={(e) => nav({ min: e.target.value })} placeholder="0.00" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Max amount
              <Input inputMode="decimal" defaultValue={params.get("max") ?? ""} onBlur={(e) => nav({ max: e.target.value })} placeholder="Any" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Status
              <Select value={filters.status ?? ""} onChange={(e) => nav({ status: e.target.value })}>
                <option value="">Any</option>
                <option value="pending">Pending</option>
                <option value="cleared">Cleared</option>
                <option value="reconciled">Reconciled</option>
              </Select>
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Reviewed
              <Select value={filters.reviewed === undefined ? "" : filters.reviewed ? "yes" : "no"} onChange={(e) => nav({ reviewed: e.target.value })}>
                <option value="">Any</option>
                <option value="no">Needs review</option>
                <option value="yes">Reviewed</option>
              </Select>
            </label>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[13px] text-muted">
        <p aria-live="polite">
          {result.total.toLocaleString()} transaction{result.total === 1 ? "" : "s"} · in <Money value={result.inflow} currency={currency} className="text-text" /> · out{" "}
          <Money value={-result.outflow} currency={currency} className="text-text" />
          <span className="ml-1">(includes transfers)</span>
        </p>
        <label className="flex items-center gap-2">
          <ArrowDownUp className="size-3.5" />
          <span className="sr-only">Sort by</span>
          <Select className="h-8 w-auto text-[13px]" value={sort} onChange={(e) => nav({ sort: e.target.value })}>
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_asc">Largest spending</option>
            <option value="amount_desc">Largest income</option>
            <option value="merchant">Payee A–Z</option>
          </Select>
        </label>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm shadow-card" role="region" aria-label="Bulk actions">
          <span className="font-medium">{selected.size} selected</span>
          <Select
            aria-label="Set category for selected"
            className="h-8 w-auto bg-surface text-[13px]"
            value=""
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value;
              if (v) void bulk({ categoryId: v === "none" ? null : v }, "Categorised");
            }}
          >
            <option value="">Set category…</option>
            <option value="none">Uncategorised</option>
            <CategoryOptions pickers={pickers} />
          </Select>
          <Button size="sm" disabled={busy} onClick={() => bulk({ reviewed: true }, "Marked reviewed")}>
            <CheckCircle2 /> Mark reviewed
          </Button>
          <Button size="sm" disabled={busy} onClick={() => bulk({ status: "cleared" }, "Marked cleared")}>
            Mark cleared
          </Button>
          <Button size="sm" variant="danger-ghost" disabled={busy} onClick={() => setConfirmDelete({ ids: [...selected], label: `${selected.size} transactions` })}>
            <Trash2 /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {result.items.length === 0 ? (
          <EmptyState
            icon={<Receipt />}
            title={activeFilterCount || filters.q ? "No transactions match" : "No transactions yet"}
            action={
              activeFilterCount || filters.q ? (
                <Button onClick={() => router.push("/transactions")}>Clear filters</Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => open()}>
                    Add transaction
                  </Button>
                  <Link href="/transactions/import" className="inline-flex h-9 items-center rounded-md border border-border px-3.5 text-sm font-medium hover:bg-surface-2">
                    Import CSV
                  </Link>
                </div>
              )
            }
          >
            {activeFilterCount || filters.q ? "Try a different search or remove a filter." : "Add one by hand or import a CSV export from your bank."}
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Transactions</caption>
            <thead className="hidden border-b border-border bg-surface-2/60 text-left text-xs text-muted md:table-header-group">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5">
                  <Checkbox aria-label="Select all on this page" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(result.items.map((t) => t.id)))} />
                </th>
                <th scope="col" className="px-2 py-2.5 font-medium">Date</th>
                <th scope="col" className="px-2 py-2.5 font-medium">Payee</th>
                <th scope="col" className="px-2 py-2.5 font-medium">Category</th>
                <th scope="col" className="px-2 py-2.5 font-medium">Account</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th scope="col" className="w-10 px-2 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result.items.map((t) => (
                <tr key={t.id} className={cn("group align-middle hover:bg-surface-2/50", selected.has(t.id) && "bg-accent-soft/50")}>
                  <td className="hidden w-10 px-3 py-2.5 md:table-cell">
                    <Checkbox aria-label={`Select ${t.merchant} ${t.date}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                  </td>
                  <td className="hidden whitespace-nowrap px-2 py-2.5 text-muted md:table-cell">{formatDisplayDate(t.date)}</td>
                  <td className="px-3 py-2.5 md:px-2" colSpan={1}>
                    <button className="block w-full min-w-0 text-left" onClick={() => edit(t)}>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{t.merchant}</span>
                        {t.status === "pending" && (
                          <Badge tone="warning">
                            <Clock className="size-3" />
                            Pending
                          </Badge>
                        )}
                        {!t.reviewed && t.kind === "standard" && <span className="size-1.5 shrink-0 rounded-full bg-info" title="Not reviewed yet" aria-label="Not reviewed" />}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted md:hidden">
                        {formatDisplayDate(t.date)} · {categoryLabel(t)} · {t.accountName}
                      </span>
                      {t.notes && <span className="mt-0.5 hidden truncate text-xs text-muted md:block">{t.notes}</span>}
                    </button>
                  </td>
                  <td className="hidden px-2 py-2.5 md:table-cell">
                    <span className={cn("inline-flex items-center gap-1.5 text-[13px]", !t.categoryName && t.kind === "standard" && !t.isSplit ? "text-warning" : "text-text-2")}>
                      {t.kind === "transfer" && <ArrowLeftRight className="size-3.5 text-muted" />}
                      {t.isSplit && <Split className="size-3.5 text-muted" />}
                      {categoryLabel(t)}
                    </span>
                    {t.tags.length > 0 && <span className="ml-1.5 text-xs text-muted">{t.tags.map((x) => `#${x}`).join(" ")}</span>}
                  </td>
                  <td className="hidden px-2 py-2.5 text-[13px] text-muted md:table-cell">{t.accountName}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <Money value={t.amount} currency={t.currency} signed tone={t.kind === "transfer" ? "none" : t.amount > 0 ? "auto" : "none"} className={cn("font-medium", t.kind === "transfer" && "text-muted")} />
                  </td>
                  <td className="px-2 py-2.5">
                    <Menu>
                      <MenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.merchant}`}>
                          <MoreHorizontal />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem icon={<Pencil />} onSelect={() => edit(t)} disabled={t.kind === "adjustment"}>
                          Edit
                        </MenuItem>
                        {t.kind === "standard" && (
                          <MenuItem
                            icon={<CheckCircle2 />}
                            onSelect={async () => {
                              const r = await updateTransactionAction({ id: t.id, reviewed: !t.reviewed });
                              if (!r.ok) toast.error(r.error);
                              router.refresh();
                            }}
                          >
                            {t.reviewed ? "Mark as not reviewed" : "Mark reviewed"}
                          </MenuItem>
                        )}
                        <MenuItem icon={<History />} onSelect={() => showHistory(t)}>
                          History
                        </MenuItem>
                        {t.kind === "transfer" && (
                          <MenuItem
                            icon={<Unlink />}
                            onSelect={async () => {
                              const r = await unlinkTransferAction({ id: t.id });
                              if (!r.ok) return toast.error(r.error);
                              toast.success("Unlinked. Both sides now need a category.");
                              router.refresh();
                            }}
                          >
                            Unlink transfer
                          </MenuItem>
                        )}
                        <MenuSeparator />
                        <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirmDelete({ ids: [t.id], label: t.kind === "transfer" ? "this transfer (both sides)" : `“${t.merchant}”` })}>
                          Delete
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {result.pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <Button size="sm" disabled={result.page <= 1} onClick={() => nav({ page: String(result.page - 1) })}>
            <ChevronLeft /> Previous
          </Button>
          <span className="text-muted">
            Page {result.page} of {result.pages}
          </span>
          <Button size="sm" disabled={result.page >= result.pages} onClick={() => nav({ page: String(result.page + 1) })}>
            Next <ChevronRight />
          </Button>
        </nav>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Delete transactions?"
        description={<>This permanently removes {confirmDelete?.label} and updates every balance, budget and report. A record of the deletion is kept in the history. Reconciled transactions are skipped.</>}
        confirmLabel="Delete"
        danger
        loading={busy}
        onConfirm={doDelete}
      />

      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent title={`History · ${history?.title ?? ""}`} description="Every change to this transaction, newest first.">
          <ol className="space-y-3 text-sm">
            {history?.rows.map((h) => (
              <li key={h.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize">{h.action.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted">{new Date(h.createdAt).toLocaleString("en-NZ")}</span>
                </div>
                <p className="text-xs text-muted">by {h.source}</p>
                {h.changes !== null && h.changes !== undefined && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono text-[11px] text-text-2">{JSON.stringify(h.changes, null, 2)}</pre>
                )}
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}
