"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FileUp, RotateCcw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Select, buttonStyles } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import { Money } from "@/components/money";
import { commitImportAction, previewImportAction, undoImportAction } from "@/server/actions/settings";
import type { ColumnMapping } from "@/domain/import";
import { formatDisplayDate } from "@/domain/dates";

type Preview = Extract<Awaited<ReturnType<typeof previewImportAction>>, { ok: true }>["data"];

const ROLES: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: "date", label: "Date", required: true },
  { key: "description", label: "Description", required: true },
  { key: "amount", label: "Amount (signed)" },
  { key: "debit", label: "Debit / money out" },
  { key: "credit", label: "Credit / money in" },
  { key: "payee", label: "Payee" },
  { key: "reference", label: "Reference" },
  { key: "category", label: "Category" },
  { key: "externalId", label: "Unique transaction ID" },
];

export function ImportWizard({
  accounts,
  defaultAccountId,
  batches,
}: {
  accounts: { id: string; name: string; currency: string }[];
  defaultAccountId?: string;
  batches: { id: string; accountName: string; fileName: string | null; createdAt: string; imported: number; duplicates: number; errors: number; status: string }[];
}) {
  const router = useRouter();
  const [accountId, setAccountId] = React.useState(accounts.find((a) => a.id === defaultAccountId)?.id ?? accounts[0]?.id ?? "");
  const [file, setFile] = React.useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [mapping, setMapping] = React.useState<ColumnMapping | null>(null);
  const [excluded, setExcluded] = React.useState<Set<number>>(new Set());
  const [includeMaybe, setIncludeMaybe] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ batchId: string; imported: number; duplicates: number; errors: number } | null>(null);
  const [undoId, setUndoId] = React.useState<string | null>(null);
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? "NZD";

  async function runPreview(text: string, m: ColumnMapping | null) {
    setLoading(true);
    setError(null);
    const r = await previewImportAction({ accountId, text, mapping: m });
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      setPreview(null);
      return;
    }
    setPreview(r.data);
    setMapping(r.data.mapping);
    setExcluded(new Set());
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return setError("That file is larger than 2 MB. Export a shorter date range.");
    const text = await f.text();
    setFile({ name: f.name, text });
    setDone(null);
    await runPreview(text, null);
  }

  async function commit() {
    if (!file || !mapping) return;
    setLoading(true);
    const r = await commitImportAction({ accountId, text: file.text, mapping, fileName: file.name, includePossibleDuplicates: includeMaybe, excludeRows: [...excluded] });
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setDone(r.data);
    setPreview(null);
    setFile(null);
    toast.success(`Imported ${r.data.imported} transactions`);
    router.refresh();
  }

  if (!accounts.length) {
    return (
      <Card>
        <EmptyState title="Add an account first" action={<Link href="/accounts?new=1" className={buttonStyles({ variant: "primary" })}>Add account</Link>}>
          Imported transactions go into one of your accounts.
        </EmptyState>
      </Card>
    );
  }

  const willImport = preview ? preview.rows.filter((r) => !excluded.has(r.rowNumber) && (r.status === "new" || (includeMaybe && r.status === "possible_duplicate"))) : [];
  const total = willImport.reduce((a, r) => a + (r.amount ?? 0), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        {done && (
          <Alert tone="positive" icon={<CheckCircle2 />} title={`Imported ${done.imported} transaction${done.imported === 1 ? "" : "s"}`}
            action={<Button size="sm" onClick={() => setUndoId(done.batchId)}><RotateCcw /> Undo</Button>}
          >
            {done.duplicates > 0 && <>Skipped {done.duplicates} already in Ledger. </>}
            {done.errors > 0 && <>{done.errors} row(s) couldn’t be read. </>}
            <Link className="underline" href="/transactions?reviewed=no">Review and categorise them</Link>
          </Alert>
        )}

        <Card>
          <CardHeader title="1. Choose the account and file" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Import into" htmlFor="imp-account">
              <Select id="imp-account" value={accountId} onChange={(e) => { setAccountId(e.target.value); setPreview(null); setFile(null); }}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="CSV file" htmlFor="imp-file" hint="Most NZ banks: Internet banking → Export → CSV.">
              <label htmlFor="imp-file" className={cn(buttonStyles({ variant: "secondary" }), "cursor-pointer justify-start")}>
                <FileUp /> {file ? file.name : "Choose file…"}
              </label>
              <input id="imp-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = ""; // allow choosing the same file again
              }} />
            </Field>
          </CardBody>
        </Card>

        {error && <Alert tone="negative">{error}</Alert>}
        {loading && <p className="text-sm text-muted" aria-live="polite">Reading your file…</p>}

        {preview && file && (
          <>
            <Card>
              <CardHeader title="2. Check the columns" description={preview.mapping ? "We matched these automatically. Adjust anything that looks wrong." : "We couldn’t recognise the layout. Tell us which column is which."} />
              <CardBody>
                <div className="grid gap-3 sm:grid-cols-3">
                  {ROLES.map((role) => (
                    <Field key={role.key} label={role.label} htmlFor={`map-${role.key}`}>
                      <Select
                        id={`map-${role.key}`}
                        value={mapping?.[role.key] === undefined ? "" : String(mapping[role.key])}
                        onChange={(e) => {
                          const v = e.target.value === "" ? undefined : Number(e.target.value);
                          setMapping((m) => ({ ...(m ?? { date: 0, description: 1, dateFormat: "DMY" }), [role.key]: v }) as ColumnMapping);
                        }}
                      >
                        <option value="">{role.required ? "Choose…" : "Not in file"}</option>
                        {preview.header.map((h, i) => (
                          <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                  <Field label="Date format" htmlFor="map-df">
                    <Select id="map-df" value={mapping?.dateFormat ?? "DMY"} onChange={(e) => setMapping((m) => ({ ...(m ?? { date: 0, description: 1 }), dateFormat: e.target.value as ColumnMapping["dateFormat"] }) as ColumnMapping)}>
                      <option value="DMY">DD/MM/YYYY (NZ)</option>
                      <option value="MDY">MM/DD/YYYY (US)</option>
                      <option value="YMD">YYYY-MM-DD</option>
                    </Select>
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm text-text-2">
                    <Checkbox checked={Boolean(mapping?.invertAmounts)} onChange={(e) => setMapping((m) => (m ? { ...m, invertAmounts: e.target.checked } : m))} />
                    Purchases are positive in this file
                  </label>
                </div>
                <div className="mt-4">
                  <Button onClick={() => runPreview(file.text, mapping)} loading={loading}>Update preview</Button>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="3. Review"
                description={
                  <>
                    {preview.totalRows} rows · <span className="text-positive">{preview.stats.new} new</span> · {preview.stats.duplicate} already imported · {preview.stats.possible_duplicate} possible duplicates · {preview.stats.error} unreadable
                  </>
                }
              />
              <CardBody>
                {preview.previouslyImportedAt && (
                  <Alert tone="info" className="mb-3">You imported this exact file on {new Date(preview.previouslyImportedAt).toLocaleDateString("en-NZ")}. Rows already in Ledger will be skipped.</Alert>
                )}
                {preview.beforeOpeningBalance && (
                  <Alert tone="warning" className="mb-3" icon={<TriangleAlert />}>
                    Some rows are dated before this account’s opening balance. Importing them will change the balance — afterwards, use “Adjust balance” on the account to match your bank.
                  </Alert>
                )}
                {preview.stats.possible_duplicate > 0 && (
                  <label className="mb-3 flex items-center gap-2 text-sm">
                    <Checkbox checked={includeMaybe} onChange={(e) => setIncludeMaybe(e.target.checked)} />
                    Also import the {preview.stats.possible_duplicate} possible duplicates (they look like transactions you already entered)
                  </label>
                )}
                <div className="max-h-[420px] overflow-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
                      <tr>
                        <th className="w-8 px-3 py-2"><span className="sr-only">Include</span></th>
                        <th className="px-2 py-2 font-medium">Date</th>
                        <th className="px-2 py-2 font-medium">Payee</th>
                        <th className="px-2 py-2 text-right font-medium">Amount</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {preview.rows.slice(0, 200).map((r) => {
                        const importable = r.status === "new" || (includeMaybe && r.status === "possible_duplicate");
                        return (
                          <tr key={r.rowNumber} className={cn(!importable && "text-muted")}>
                            <td className="px-3 py-1.5">
                              {(r.status === "new" || r.status === "possible_duplicate") && (
                                <Checkbox
                                  aria-label={`Include row ${r.rowNumber}`}
                                  checked={importable && !excluded.has(r.rowNumber)}
                                  disabled={!importable}
                                  onChange={() => setExcluded((s) => { const n = new Set(s); if (n.has(r.rowNumber)) n.delete(r.rowNumber); else n.add(r.rowNumber); return n; })}
                                />
                              )}
                            </td>
                            <td className="whitespace-nowrap px-2 py-1.5">{r.date ? formatDisplayDate(r.date, { year: true }) : "—"}</td>
                            <td className="max-w-64 px-2 py-1.5">
                              <span className="block truncate">{r.merchantName}</span>
                              {r.merchantName !== r.description && <span className="block truncate text-xs text-muted">{r.description}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right">{r.amount !== null ? <Money value={r.amount} currency={currency} signed /> : "—"}</td>
                            <td className="px-3 py-1.5">
                              {r.status === "new" && <Badge tone="positive">New</Badge>}
                              {r.status === "duplicate" && <Badge>Already imported</Badge>}
                              {r.status === "possible_duplicate" && <Badge tone="warning">Possible duplicate</Badge>}
                              {r.status === "error" && <Badge tone="negative" title={r.errors.join("; ")}>{r.errors[0]}</Badge>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {preview.totalRows > 200 && <p className="p-3 text-center text-xs text-muted">Showing the first 200 of {preview.totalRows} rows. All valid rows will be imported.</p>}
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    {willImport.length} to import · net <Money value={total} currency={currency} signed />
                  </p>
                  <Button variant="primary" onClick={commit} loading={loading} disabled={!willImport.length}>
                    Import {willImport.length} transaction{willImport.length === 1 ? "" : "s"}
                  </Button>
                </div>
              </CardBody>
            </Card>
          </>
        )}
      </div>

      <aside className="space-y-4">
        <Card>
          <CardHeader title="Recent imports" as="h3" />
          <CardBody>
            {batches.length === 0 ? (
              <p className="text-sm text-muted">No imports yet.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {batches.map((b) => (
                  <li key={b.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.fileName ?? "CSV import"}</p>
                      <p className="text-xs text-muted">
                        {b.accountName} · {new Date(b.createdAt).toLocaleDateString("en-NZ")} · {b.imported} added{b.status === "undone" && " · undone"}
                      </p>
                    </div>
                    {b.status === "completed" && b.imported > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setUndoId(b.id)}>Undo</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card className="p-4 text-[13px] text-muted">
          <p className="font-medium text-text">Supported files</p>
          <p className="mt-1">CSV exports from ANZ, ASB, BNZ, Kiwibank, Westpac and most other banks. One signed amount column, or separate debit and credit columns. See <span className="font-mono">docs/CSV_FORMATS.md</span> for the exact format.</p>
          <p className="mt-2">Re-importing the same file never creates duplicates.</p>
        </Card>
      </aside>

      <ConfirmDialog
        open={!!undoId}
        onOpenChange={(o) => !o && setUndoId(null)}
        title="Undo this import?"
        description="Every transaction added by this import will be removed (reconciled ones are kept). Your other transactions aren’t affected."
        confirmLabel="Undo import"
        danger
        loading={loading}
        onConfirm={async () => {
          setLoading(true);
          const r = await undoImportAction({ batchId: undoId! });
          setLoading(false);
          setUndoId(null);
          if (!r.ok) return toast.error(r.error);
          toast.success(`Removed ${r.data.removed} transactions`);
          setDone(null);
          router.refresh();
        }}
      />
    </div>
  );
}
