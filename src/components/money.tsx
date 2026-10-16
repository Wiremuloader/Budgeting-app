"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatMoney, parseAmount, toDecimalString } from "@/domain/money";
import { Input } from "./ui/primitives";

/**
 * Display a money amount from integer minor units. Formatting goes through the
 * domain formatter, which is exact (no float conversion).
 */
export function Money({
  value,
  currency = "NZD",
  tone = "none",
  signed,
  compact,
  className,
  hideMinus,
}: {
  value: number;
  currency?: string;
  /** "auto": jade for positive, brick for negative. "negative": brick only when < 0. */
  tone?: "none" | "auto" | "negative";
  signed?: boolean;
  compact?: boolean;
  className?: string;
  hideMinus?: boolean;
}) {
  const shown = hideMinus ? Math.abs(value) : value;
  const color =
    tone === "auto" ? (value > 0 ? "text-positive" : value < 0 ? "text-negative" : "") : tone === "negative" && value < 0 ? "text-negative" : "";
  return <span className={cn("num whitespace-nowrap", color, className)}>{formatMoney(shown, currency, { signed, compact })}</span>;
}

/**
 * Money input: accepts what people type ("12", "1,200.50", "-4.5") and reports
 * integer minor units or a validation error. Never uses parseFloat.
 */
export function MoneyInput({
  value,
  onChange,
  currency = "NZD",
  id,
  name,
  placeholder = "0.00",
  allowNegative = false,
  invalid,
  className,
  autoFocus,
  required,
  "aria-describedby": describedBy,
}: {
  value: number | null;
  onChange: (cents: number | null, error: string | null) => void;
  currency?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  allowNegative?: boolean;
  invalid?: boolean;
  className?: string;
  autoFocus?: boolean;
  required?: boolean;
  "aria-describedby"?: string;
}) {
  const [text, setText] = React.useState(value === null ? "" : toDecimalString(value, currency));
  const last = React.useRef(value);
  React.useEffect(() => {
    if (value !== last.current) {
      setText(value === null ? "" : toDecimalString(value, currency));
      last.current = value;
    }
  }, [value, currency]);

  function handle(next: string) {
    setText(next);
    if (!next.trim()) {
      last.current = null;
      onChange(null, required ? "Enter an amount" : null);
      return;
    }
    try {
      const cents = parseAmount(next, currency);
      if (!allowNegative && cents < 0) {
        onChange(null, "Enter a positive amount");
        return;
      }
      last.current = cents;
      onChange(cents, null);
    } catch (e) {
      onChange(null, (e as Error).message.replace(/^"[^"]*" /, "This "));
    }
  }

  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">$</span>
      <Input
        id={id}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => handle(e.target.value)}
        onBlur={() => {
          if (last.current !== null) setText(toDecimalString(last.current, currency));
        }}
        className="num pl-7"
      />
    </div>
  );
}

export function Delta({ value, currency = "NZD", inverse, className }: { value: number; currency?: string; inverse?: boolean; className?: string }) {
  // For spending, an increase is bad (inverse).
  const good = inverse ? value < 0 : value > 0;
  if (value === 0) return <span className={cn("text-xs text-muted", className)}>No change</span>;
  return (
    <span className={cn("num text-xs font-medium", good ? "text-positive" : "text-negative", className)}>
      {value > 0 ? "▲" : "▼"} {formatMoney(Math.abs(value), currency, { compact: Math.abs(value) >= 100_00 })}
    </span>
  );
}
