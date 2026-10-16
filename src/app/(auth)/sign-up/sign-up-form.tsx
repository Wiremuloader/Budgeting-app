"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Alert, Button, EmptyState, Field, Input } from "@/components/ui/primitives";

const schema = z.object({
  name: z.string().trim().min(1, "Tell us what to call you").max(80),
  email: z.email("Enter a valid email address"),
  password: z.string().min(10, "Use at least 10 characters").max(128),
});
type Values = z.infer<typeof schema>;

export function SignUpForm({ requireVerification }: { requireVerification: boolean }) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched" });

  async function onSubmit(v: Values) {
    setError(null);
    const { error } = await authClient.signUp.email({ ...v, callbackURL: "/onboarding" });
    if (error) {
      setError(
        error.status === 422 || /exist/i.test(error.message ?? "")
          ? "An account with that email already exists."
          : error.status === 429
            ? "Too many attempts. Try again in a minute."
            : (error.message ?? "Something went wrong. Please try again."),
      );
      return;
    }
    if (requireVerification) setSent(true);
    else {
      router.replace("/onboarding");
      router.refresh();
    }
  }

  if (sent) {
    return (
      <EmptyState icon={<MailCheck />} title="Check your email">
        We sent a verification link. Open it to finish creating your account.
      </EmptyState>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
      <div>
        <h1 className="font-display text-4xl tracking-tight">Create your account</h1>
        <p className="mt-2 text-sm text-muted">Setup takes about three minutes. You can skip anything and come back later.</p>
      </div>
      {error && <Alert tone="negative">{error}</Alert>}
      <Field label="Name" htmlFor="name" error={formState.errors.name?.message}>
        <Input id="name" autoComplete="given-name" autoFocus aria-invalid={!!formState.errors.name} {...register("name")} />
      </Field>
      <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!formState.errors.email} {...register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={formState.errors.password?.message} hint="At least 10 characters. A short phrase is easier to remember than symbols.">
        <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!formState.errors.password} {...register("password")} />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting}>
        Create account
      </Button>
      <p className="text-xs leading-relaxed text-muted">
        Ledger is a budgeting tool, not a financial adviser. Your data stays in your account and is never sold. You can export or delete it at any time.
      </p>
      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
