import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listAccounts } from "@/server/services/accounts";
import { Logo } from "@/components/logo";
import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = { title: "Set up Ledger" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const { user, prefs, today } = await requireContext();
  if (prefs.onboardingCompletedAt) redirect("/overview");
  const db = await getDb();
  const hasAccounts = (await listAccounts(db, user.id)).length > 0;
  return (
    <div className="min-h-dvh">
      <header className="flex h-16 items-center justify-between border-b border-border px-5 sm:px-8">
        <Logo />
        <span className="text-sm text-muted">Signed in as {user.email}</span>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-8 sm:py-12">
        <OnboardingWizard name={user.name.split(" ")[0]} today={today} hasAccounts={hasAccounts} />
      </main>
    </div>
  );
}
