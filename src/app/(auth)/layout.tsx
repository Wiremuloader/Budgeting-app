import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-surface-2 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Logo />
        <div className="max-w-md">
          <p className="font-display text-[44px] leading-[1.05] tracking-tight text-text">Know where every dollar is going — and what’s safe to spend.</p>
          <ul className="mt-8 space-y-3 text-[15px] text-text-2">
            <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />Budgets that account for every refund, transfer and split, to the cent.</li>
            <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />Forecasts that show their assumptions, never guesses dressed up as facts.</li>
            <li className="flex gap-3"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />Built in Aotearoa for NZ banks’ CSV exports, fortnightly pay and StudyLink.</li>
          </ul>
        </div>
        <p className="text-xs text-muted">Ledger never asks for your online banking password.</p>
        <svg className="pointer-events-none absolute -right-24 top-24 w-[420px] opacity-[0.07]" viewBox="0 0 200 200" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <line key={i} x1="0" x2="200" y1={i * 14 + 6} y2={i * 14 + 6} stroke="var(--text)" strokeWidth="1" />
          ))}
        </svg>
      </aside>
      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
