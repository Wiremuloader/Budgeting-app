"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Download, KeyRound, LogOut, MonitorSmartphone, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Select } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog, DialogContent, DialogFooter, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlay";
import { MoneyInput } from "@/components/money";
import { CategoryManager, type ManagedCategory } from "../budget/category-manager";
import { authClient } from "@/lib/auth-client";
import { updateNotificationPreferenceAction, updatePreferencesAction } from "@/server/actions/settings";
import { removeSampleDataAction } from "@/server/actions/finance";
import type { CurrentUser } from "@/server/auth/session";

interface Prefs {
  country: string;
  currency: string;
  timezone: string;
  budgetMethod: "envelope" | "flexible";
  budgetMode: "guided" | "manual";
  safetyBuffer: number;
  lowBalanceThreshold: number;
  aiEnabled: boolean;
  incomeFrequency: string | null;
}

interface NotifRow {
  type: string;
  label: string;
  description: string;
  threshold?: "bps" | "days" | "cents";
  enabled: boolean;
  thresholdValue: number | null;
  email: boolean;
}

const TIMEZONES = ["Pacific/Auckland", "Pacific/Chatham", "Australia/Sydney", "Australia/Brisbane", "Australia/Perth", "Pacific/Fiji", "Pacific/Rarotonga", "Asia/Singapore", "Europe/London", "America/Los_Angeles", "America/New_York", "UTC"];
const CURRENCIES = ["NZD", "AUD", "USD", "GBP", "EUR", "CAD", "SGD", "FJD", "JPY"];

export function SettingsView({
  tab,
  user,
  prefs,
  categories,
  notifications,
  emailAvailable,
  aiAvailable,
}: {
  tab: string;
  user: CurrentUser;
  prefs: Prefs;
  categories: ManagedCategory[];
  notifications: NotifRow[];
  emailAvailable: boolean;
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList className="mb-5 h-auto flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="privacy">Privacy & AI</TabsTrigger>
          <TabsTrigger value="data">Your data</TabsTrigger>
        </TabsList>
        <TabsContent value="general"><General user={user} prefs={prefs} /></TabsContent>
        <TabsContent value="categories">
          <Card><CardHeader title="Categories" description="Archived categories keep their history in reports." /><CardBody><CategoryManager categories={categories} /></CardBody></Card>
        </TabsContent>
        <TabsContent value="notifications"><Notifications rows={notifications} emailAvailable={emailAvailable} /></TabsContent>
        <TabsContent value="security"><Security user={user} /></TabsContent>
        <TabsContent value="privacy"><Privacy prefs={prefs} aiAvailable={aiAvailable} /></TabsContent>
        <TabsContent value="data"><Data /></TabsContent>
      </Tabs>
    </>
  );
}

function General({ user, prefs }: { user: CurrentUser; prefs: Prefs }) {
  const router = useRouter();
  const [name, setName] = React.useState(user.name);
  const [p, setP] = React.useState(prefs);
  const [saving, setSaving] = React.useState(false);
  async function save() {
    setSaving(true);
    if (name !== user.name) {
      const r = await authClient.updateUser({ name });
      if (r.error) {
        setSaving(false);
        return toast.error("Couldn't update your name");
      }
    }
    const r = await updatePreferencesAction({ country: p.country, currency: p.currency, timezone: p.timezone, budgetMode: p.budgetMode, safetyBuffer: p.safetyBuffer, lowBalanceThreshold: p.lowBalanceThreshold });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Settings saved");
    router.refresh();
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Profile" />
        <CardBody className="grid gap-4">
          <Field label="Name" htmlFor="s-name"><Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
          <Field label="Email" htmlFor="s-email" hint={user.emailVerified ? "Verified" : "Not verified yet"}><Input id="s-email" value={user.email} disabled /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Region" description="Changing currency affects how new accounts are created. Existing amounts are never converted." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Country" htmlFor="s-country">
            <Select id="s-country" value={p.country} onChange={(e) => setP({ ...p, country: e.target.value })}>
              <option value="NZ">New Zealand</option><option value="AU">Australia</option><option value="GB">United Kingdom</option><option value="US">United States</option><option value="CA">Canada</option><option value="SG">Singapore</option><option value="FJ">Fiji</option>
            </Select>
          </Field>
          <Field label="Main currency" htmlFor="s-cur">
            <Select id="s-cur" value={p.currency} onChange={(e) => setP({ ...p, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
          <Field label="Time zone" htmlFor="s-tz" hint="Decides what “today” means for budgets and bills." className="sm:col-span-2">
            <Select id="s-tz" value={p.timezone} onChange={(e) => setP({ ...p, timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select>
          </Field>
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="Safety margins" description="Used by safe-to-spend, forecasts and alerts." />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Safety buffer" htmlFor="s-buf" hint="Kept aside from safe-to-spend."><MoneyInput id="s-buf" value={p.safetyBuffer} currency={p.currency} onChange={(v) => setP({ ...p, safetyBuffer: v ?? 0 })} /></Field>
          <Field label="Low balance alert below" htmlFor="s-low" hint="Warns when the forecast drops below this."><MoneyInput id="s-low" value={p.lowBalanceThreshold} currency={p.currency} onChange={(v) => setP({ ...p, lowBalanceThreshold: v ?? 0 })} /></Field>
          <Field label="Budget suggestions" htmlFor="s-mode">
            <Select id="s-mode" value={p.budgetMode} onChange={(e) => setP({ ...p, budgetMode: e.target.value as Prefs["budgetMode"] })}>
              <option value="guided">Guided — suggest adjustments</option>
              <option value="manual">Manual — I’ll decide everything</option>
            </Select>
          </Field>
        </CardBody>
      </Card>
      <div className="lg:col-span-2"><Button variant="primary" onClick={save} loading={saving}>Save changes</Button></div>
    </div>
  );
}

function Notifications({ rows, emailAvailable }: { rows: NotifRow[]; emailAvailable: boolean }) {
  const router = useRouter();
  async function update(type: string, patch: { enabled?: boolean; threshold?: number | null; channels?: ("in_app" | "email")[] }) {
    const r = await updateNotificationPreferenceAction({ type: type as never, ...patch });
    if (!r.ok) return toast.error(r.error);
    router.refresh();
  }
  return (
    <Card>
      <CardHeader title="Alerts" description="Ledger only notifies you about things that need attention, at most a handful a day. In-app notifications are always on for enabled alerts." />
      <CardBody>
        {!emailAvailable && <Alert tone="info" className="mb-4">Email delivery isn’t configured on this server, so alerts appear in the app only.</Alert>}
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.type} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.label}</p>
                <p className="text-xs text-muted">{r.description}</p>
              </div>
              {r.threshold === "bps" && r.enabled && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  Alert at
                  <Select className="h-8 w-auto" value={String(r.thresholdValue ?? 8500)} onChange={(e) => update(r.type, { threshold: Number(e.target.value) })}>
                    {[5000, 7500, 8500, 9000, 10000].map((v) => <option key={v} value={v}>{v / 100}%</option>)}
                  </Select>
                </label>
              )}
              {r.threshold === "days" && r.enabled && (
                <label className="flex items-center gap-2 text-xs text-muted">
                  Days ahead
                  <Select className="h-8 w-auto" value={String(r.thresholdValue ?? 3)} onChange={(e) => update(r.type, { threshold: Number(e.target.value) })}>
                    {[1, 2, 3, 5, 7].map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </label>
              )}
              {r.type === "low_balance" && <span className="text-xs text-muted">Threshold: set in General</span>}
              {emailAvailable && (
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <Switch checked={r.email} disabled={!r.enabled} onCheckedChange={(v) => update(r.type, { channels: v ? ["in_app", "email"] : ["in_app"] })} label={`Email for ${r.label}`} /> Email
                </label>
              )}
              <Switch checked={r.enabled} onCheckedChange={(v) => update(r.type, { enabled: v })} label={`Enable ${r.label}`} />
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

type SessionRow = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; createdAt: Date | string; expiresAt: Date | string };

function Security({ user }: { user: CurrentUser }) {
  const router = useRouter();
  const [sessions, setSessions] = React.useState<SessionRow[] | null>(null);
  const [current, setCurrent] = React.useState<string | null>(null);
  const [pw, setPw] = React.useState({ current: "", next: "" });
  const [pwSaving, setPwSaving] = React.useState(false);
  const [mfa, setMfa] = React.useState<{ step: "password" | "verify" | "done"; password: string; uri?: string; qr?: string; backup?: string[]; code: string } | null>(null);
  const [disabling, setDisabling] = React.useState(false);
  const [disablePw, setDisablePw] = React.useState("");

  const load = React.useCallback(async () => {
    const [list, s] = await Promise.all([authClient.listSessions(), authClient.getSession()]);
    setSessions((list.data as SessionRow[] | null) ?? []);
    setCurrent(s.data?.session.token ?? null);
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([authClient.listSessions(), authClient.getSession()]).then(([list, s]) => {
      if (cancelled) return;
      setSessions((list.data as SessionRow[] | null) ?? []);
      setCurrent(s.data?.session.token ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Password" />
        <CardBody>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (pw.next.length < 10) return toast.error("Use at least 10 characters");
              setPwSaving(true);
              const r = await authClient.changePassword({ currentPassword: pw.current, newPassword: pw.next, revokeOtherSessions: true });
              setPwSaving(false);
              if (r.error) return toast.error(r.error.status === 400 ? "Current password is incorrect" : "Couldn't change password");
              setPw({ current: "", next: "" });
              toast.success("Password changed. Other devices were signed out.");
              void load();
            }}
          >
            <Field label="Current password" htmlFor="pw-cur"><Input id="pw-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="New password" htmlFor="pw-new" hint="At least 10 characters."><Input id="pw-new" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <div><Button type="submit" loading={pwSaving} disabled={!pw.current || !pw.next}>Change password</Button></div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Two-step verification" description="Require a code from an authenticator app when signing in." action={user.twoFactorEnabled ? <Badge tone="positive"><ShieldCheck className="size-3" /> On</Badge> : <Badge>Off</Badge>} />
        <CardBody>
          {user.twoFactorEnabled ? (
            <Button variant="danger-ghost" onClick={() => setDisabling(true)}>Turn off two-step verification</Button>
          ) : (
            <Button variant="primary" onClick={() => setMfa({ step: "password", password: "", code: "" })}><KeyRound /> Set up</Button>
          )}
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title="Where you’re signed in"
          action={
            <Button
              size="sm"
              onClick={async () => {
                await authClient.revokeOtherSessions();
                toast.success("Signed out of all other devices");
                void load();
              }}
            >
              <LogOut /> Sign out other devices
            </Button>
          }
        />
        <CardBody>
          <ul className="divide-y divide-border text-sm">
            {sessions?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <MonitorSmartphone className="size-4 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{s.userAgent ? describeAgent(s.userAgent) : "Unknown device"} {s.token === current && <Badge tone="accent">This device</Badge>}</p>
                  <p className="text-xs text-muted">Signed in {new Date(s.createdAt).toLocaleString("en-NZ")}</p>
                </div>
                {s.token !== current && (
                  <Button size="sm" variant="ghost" onClick={async () => { await authClient.revokeSession({ token: s.token }); void load(); }}>Sign out</Button>
                )}
              </li>
            ))}
            {!sessions && <li className="py-3 text-muted">Loading…</li>}
          </ul>
        </CardBody>
      </Card>

      <Dialog open={!!mfa} onOpenChange={(o) => !o && setMfa(null)}>
        {mfa && (
          <DialogContent title="Set up two-step verification" size="sm">
            {mfa.step === "password" && (
              <form
                className="grid gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await authClient.twoFactor.enable({ password: mfa.password });
                  if (r.error || !r.data) return toast.error("Password is incorrect");
                  if (r.data.method !== "totp") return toast.error("Unexpected two-step method");
                  const qr = await QRCode.toDataURL(r.data.totpURI, { margin: 1, width: 200 });
                  setMfa({ ...mfa, step: "verify", uri: r.data.totpURI, qr, backup: r.data.backupCodes });
                }}
              >
                <Field label="Confirm your password" htmlFor="mfa-pw"><Input id="mfa-pw" type="password" autoComplete="current-password" value={mfa.password} onChange={(e) => setMfa({ ...mfa, password: e.target.value })} autoFocus /></Field>
                <DialogFooter><Button type="submit" variant="primary">Continue</Button></DialogFooter>
              </form>
            )}
            {mfa.step === "verify" && (
              <form
                className="grid gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await authClient.twoFactor.verifyTotp({ code: mfa.code.replace(/\s/g, "") });
                  if (r.error) return toast.error("That code didn't match. Check your device's clock and try again.");
                  setMfa({ ...mfa, step: "done" });
                  router.refresh();
                }}
              >
                <p className="text-sm text-text-2">Scan this with an authenticator app (such as 1Password, Google Authenticator or Authy), then enter the 6-digit code.</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {mfa.qr && <img src={mfa.qr} alt="QR code for your authenticator app" className="mx-auto size-48 rounded-lg bg-white p-2" />}
                <details className="text-xs text-muted"><summary className="cursor-pointer">Can’t scan? Enter the key manually</summary><code className="mt-1 block break-all">{new URL(mfa.uri!).searchParams.get("secret")}</code></details>
                <Field label="Code" htmlFor="mfa-code"><Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" value={mfa.code} onChange={(e) => setMfa({ ...mfa, code: e.target.value })} /></Field>
                <DialogFooter><Button type="submit" variant="primary" disabled={mfa.code.length < 6}>Verify and turn on</Button></DialogFooter>
              </form>
            )}
            {mfa.step === "done" && (
              <div className="grid gap-3 text-sm">
                <Alert tone="positive">Two-step verification is on.</Alert>
                <p>Save these backup codes somewhere safe. Each can be used once if you lose your device.</p>
                <ul className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-3 font-mono text-xs">{mfa.backup?.map((c) => <li key={c}>{c}</li>)}</ul>
                <DialogFooter><Button variant="primary" onClick={() => setMfa(null)}>I’ve saved them</Button></DialogFooter>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={disabling} onOpenChange={setDisabling}>
        <DialogContent title="Turn off two-step verification?" size="sm">
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await authClient.twoFactor.disable({ password: disablePw });
              if (r.error) return toast.error("Password is incorrect");
              setDisabling(false);
              setDisablePw("");
              toast.success("Two-step verification turned off");
              router.refresh();
            }}
          >
            <Field label="Password" htmlFor="dis-pw"><Input id="dis-pw" type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} /></Field>
            <DialogFooter><Button type="submit" variant="danger">Turn off</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function describeAgent(ua: string) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}`;
}

function Privacy({ prefs, aiAvailable }: { prefs: Prefs; aiAvailable: boolean }) {
  const router = useRouter();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="AI assistant" action={<Switch checked={prefs.aiEnabled} label="Use AI for the assistant" onCheckedChange={async (v) => { const r = await updatePreferencesAction({ aiEnabled: v }); if (!r.ok) toast.error(r.error); else { toast.success(v ? "AI turned on" : "AI turned off"); router.refresh(); } }} />} />
        <CardBody className="space-y-2 text-[13px] text-text-2">
          {!aiAvailable && <Alert tone="info">No AI provider is configured on this server, so the assistant uses direct answers only.</Alert>}
          <p>When AI is on, your question and the results of the calculations it asks for — totals, category names, merchant names and dates — are sent to Anthropic to write a reply. Raw transaction lists are limited to 20 rows per request, and account numbers, passwords and your email address are never sent.</p>
          <p>With AI off, the assistant still answers common questions directly from Ledger’s calculations, and nothing leaves this server.</p>
          <p>The assistant cannot change your data. It can suggest a budget change, which only happens if you approve it.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="How your data is handled" />
        <CardBody className="space-y-2 text-[13px] text-text-2">
          <p>Your financial records are stored in this Ledger server’s database and are only visible to your account. Ledger doesn’t sell data or use third-party analytics.</p>
          <p>Ledger never asks for or stores internet banking passwords or PINs. Bank connections, when available, use a provider’s consent flow and can be revoked at any time.</p>
          <p>Application logs record events and errors without amounts, merchants, notes or email addresses.</p>
          <p>Deleting your account permanently removes your financial data from the live database. Backups held by the hosting provider expire on their own schedule — see the operator’s privacy notice.</p>
        </CardBody>
      </Card>
    </div>
  );
}

function Data() {
  const router = useRouter();
  const [removeSample, setRemoveSample] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [confirmText, setConfirmText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Export" description="Download a copy of everything." />
        <CardBody className="flex flex-wrap gap-2">
          <a href="/api/export/transactions" className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3.5 text-sm font-medium hover:bg-surface-2"><Download className="size-4" /> Transactions (CSV)</a>
          <a href="/api/export/transactions?splits=rows" className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3.5 text-sm font-medium hover:bg-surface-2"><Download className="size-4" /> Transactions, one row per split</a>
          <a href="/api/export/all" className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3.5 text-sm font-medium hover:bg-surface-2"><Download className="size-4" /> Everything (JSON)</a>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sample data" description="Remove the demo accounts and everything linked to them." />
        <CardBody><Button onClick={() => setRemoveSample(true)}>Remove sample data</Button></CardBody>
      </Card>
      <Card className="border-negative/40 lg:col-span-2">
        <CardHeader title="Delete account" description="Permanently deletes your login and all financial data. This can’t be undone — export first if you want a copy." />
        <CardBody><Button variant="danger" onClick={() => setDeleting(true)}><Trash2 /> Delete my account</Button></CardBody>
      </Card>

      <ConfirmDialog
        open={removeSample}
        onOpenChange={setRemoveSample}
        title="Remove sample data?"
        description="Sample accounts, their transactions, and goals or debts linked to them are deleted. Your own accounts aren’t touched."
        confirmLabel="Remove"
        danger
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          const r = await removeSampleDataAction();
          setBusy(false);
          setRemoveSample(false);
          if (!r.ok) return toast.error(r.error);
          toast.success(r.data.accounts ? `Removed ${r.data.accounts} accounts and ${r.data.transactions} transactions` : "There was no sample data");
          router.refresh();
        }}
      />
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent title="Delete your account permanently?" size="sm">
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await authClient.deleteUser({ password });
              setBusy(false);
              if (r.error) return toast.error(r.error.status === 400 ? "Password is incorrect" : "For security, please sign in again and retry.");
              router.replace("/sign-up");
            }}
          >
            <p className="text-sm text-text-2">All accounts, transactions, budgets, goals and history will be deleted.</p>
            <Field label="Password" htmlFor="del-pw"><Input id="del-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label='Type "delete" to confirm' htmlFor="del-confirm"><Input id="del-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} /></Field>
            <DialogFooter><Button type="submit" variant="danger" loading={busy} disabled={confirmText !== "delete" || !password}>Delete everything</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
