"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";

function safeNext(next: string | null): string {
  // Only allow same-site relative paths to avoid open redirects.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/overview";
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = React.useState<"password" | "2fa">(params.get("step") === "2fa" ? "2fa" : "password");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [useBackup, setUseBackup] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const next = safeNext(params.get("next"));

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { data, error } = await authClient.signIn.email({ email, password });
    setLoading(false);
    if (error) {
      setError(error.status === 403 ? "Please verify your email first — we've sent you a new link." : error.status === 429 ? "Too many attempts. Wait a minute and try again." : "That email and password don't match.");
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setStep("2fa");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
      : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice: false });
    setLoading(false);
    if (res.error) {
      setError(res.error.status === 429 ? "Too many attempts. Wait a minute and try again." : "That code isn't valid.");
      return;
    }
    router.replace(next);
    router.refresh();
  }

  if (step === "2fa") {
    return (
      <form onSubmit={submitCode} className="grid gap-4" noValidate>
        <div>
          <h1 className="font-display text-4xl tracking-tight">Two-step verification</h1>
          <p className="mt-2 text-sm text-muted">{useBackup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}</p>
        </div>
        {error && <Alert tone="negative">{error}</Alert>}
        <Field label={useBackup ? "Backup code" : "Authentication code"} htmlFor="code">
          <Input id="code" autoFocus autoComplete="one-time-code" inputMode={useBackup ? "text" : "numeric"} value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={loading}>
          Verify
        </Button>
        <button type="button" className="text-sm text-accent hover:underline" onClick={() => setUseBackup((v) => !v)}>
          {useBackup ? "Use authenticator code instead" : "Use a backup code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="grid gap-4" noValidate>
      <div>
        <h1 className="font-display text-4xl tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm text-muted">Sign in to see where your money stands.</p>
      </div>
      {params.get("reset") === "1" && <Alert tone="positive">Password updated. Sign in with your new password.</Alert>}
      {params.get("verified") === "1" && <Alert tone="positive">Email verified. You can sign in now.</Alert>}
      {error && <Alert tone="negative">{error}</Alert>}
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <div className="-mt-1 text-right">
        <Link href="/forgot-password" className="text-sm text-accent hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" variant="primary" size="lg" loading={loading} disabled={!email || !password}>
        Sign in
      </Button>
      <p className="text-center text-sm text-muted">
        New to Ledger?{" "}
        <Link href="/sign-up" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
