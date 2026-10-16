"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, Field, Input } from "@/components/ui/primitives";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(params.get("error") ? "This reset link is invalid or has expired." : null);
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) return setError("Use at least 10 characters.");
    if (password !== confirm) return setError("The passwords don't match.");
    if (!token) return setError("This reset link is invalid or has expired.");
    setLoading(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    setLoading(false);
    if (error) return setError("This reset link is invalid or has expired.");
    router.replace("/sign-in?reset=1");
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h1 className="font-display text-4xl tracking-tight">Choose a new password</h1>
        <p className="mt-2 text-sm text-muted">You’ll be signed out on other devices.</p>
      </div>
      {error && (
        <Alert tone="negative">
          {error}{" "}
          <Link href="/forgot-password" className="underline">
            Request a new link
          </Link>
        </Alert>
      )}
      <Field label="New password" htmlFor="pw">
        <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Confirm password" htmlFor="pw2">
        <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={loading}>
        Update password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
