"use client";

import * as React from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, EmptyState, Field, Input } from "@/components/ui/primitives";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [state, setState] = React.useState<"idle" | "loading" | "sent" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    // Same response whether or not the account exists, so emails can't be enumerated.
    setState(error && error.status === 429 ? "error" : "sent");
  }

  if (state === "sent") {
    return (
      <EmptyState
        icon={<MailCheck />}
        title="Check your email"
        action={
          <Link className="text-sm text-accent hover:underline" href="/sign-in">
            Back to sign in
          </Link>
        }
      >
        If an account exists for {email}, we’ve sent a link to reset the password. It expires in one hour.
      </EmptyState>
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div>
        <h1 className="font-display text-4xl tracking-tight">Reset your password</h1>
        <p className="mt-2 text-sm text-muted">We’ll email you a secure link.</p>
      </div>
      {state === "error" && <Alert tone="negative">Too many requests. Please wait a few minutes.</Alert>}
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={state === "loading"} disabled={!email}>
        Send reset link
      </Button>
      <Link href="/sign-in" className="text-center text-sm text-accent hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
