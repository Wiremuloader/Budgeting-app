import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[34px] leading-tight tracking-tight text-text sm:text-[38px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SampleDataBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-warning/60 px-2 py-0.5 text-[11px] font-medium text-warning" title="Created by the demo seed. Delete it any time.">
      Sample data
    </span>
  );
}
