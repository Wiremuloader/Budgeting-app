import { cn } from "@/lib/utils";

/** Ledger mark: two ruled lines and a rising stroke — a ledger page that balances. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M8 21.5h16M8 25h10" stroke="var(--accent-fg)" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
      <path d="M9 16.5l4.5-4.5 3.5 3 6-7" fill="none" stroke="var(--accent-fg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {!collapsed && <span className="font-display text-[22px] leading-none tracking-tight text-text">Ledger</span>}
    </span>
  );
}
