import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- Button */

export const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:bg-accent-hover",
        secondary: "bg-surface border border-border text-text hover:bg-surface-2",
        ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
        danger: "bg-negative text-white hover:opacity-90",
        "danger-ghost": "text-negative hover:bg-negative-soft",
        link: "text-accent underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-3.5",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(buttonStyles({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

/* ----------------------------------------------------------------- Inputs */

const fieldBase =
  "w-full rounded-md border border-border bg-surface px-3 text-sm text-text placeholder:text-muted/80 transition-colors focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:opacity-60 aria-[invalid=true]:border-negative";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-9", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2", className)} {...props} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        fieldBase,
        "h-9 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b6f76%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-text-2", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
  optional?: boolean;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-negative" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={cn("size-4 rounded border-border-strong accent-[var(--accent)] cursor-pointer", className)} {...props} />;
}

/* ------------------------------------------------------------------ Card */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  className,
  as: Tag = "h2",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4", className)}>
      <div className="min-w-0">
        <Tag className="text-[15px] font-semibold tracking-tight text-text">{title}</Tag>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5 pt-3", className)} {...props} />;
}

/* ----------------------------------------------------------------- Badge */

export const badgeStyles = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-surface-2 text-text-2",
      accent: "bg-accent-soft text-accent",
      positive: "bg-accent-soft text-positive",
      negative: "bg-negative-soft text-negative",
      warning: "bg-warning-soft text-warning",
      info: "bg-info-soft text-info",
      outline: "border border-border text-muted",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ tone, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />;
}

/* -------------------------------------------------------------- Progress */

export function Progress({
  value,
  max = 100,
  tone = "accent",
  className,
  label,
}: {
  value: number;
  max?: number;
  tone?: "accent" | "warning" | "negative" | "muted";
  className?: string;
  label: string;
}) {
  const pct = max > 0 ? Math.min(Math.max((value / max) * 100, 0), 100) : 0;
  const color = { accent: "bg-accent", warning: "bg-warning", negative: "bg-negative", muted: "bg-muted" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* --------------------------------------------------------- Feedback bits */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-3/70", className)} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 grid size-10 place-items-center rounded-full bg-surface-2 text-muted [&_svg]:size-5">{icon}</div>}
      <p className="text-[15px] font-semibold text-text">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: "info" | "warning" | "negative" | "positive";
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "bg-info-soft text-info",
    warning: "bg-warning-soft text-warning",
    negative: "bg-negative-soft text-negative",
    positive: "bg-accent-soft text-positive",
  };
  return (
    <div role={tone === "negative" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg px-4 py-3 text-sm", tones[tone], className)}>
      {icon && <div className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</div>}
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn("text-text-2", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-border", className)} />;
}

export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</kbd>;
}
