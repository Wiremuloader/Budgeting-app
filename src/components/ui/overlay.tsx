"use client";

import * as React from "react";
import { Dialog as D, DropdownMenu as DM, Tooltip as T, Tabs as Tb, Switch as Sw, Popover as P } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- Dialog */

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  size = "md",
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const width = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size];
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
      <D.Content
        className={cn(
          "fixed z-50 flex max-h-[92dvh] w-full flex-col overflow-hidden border border-border bg-surface shadow-pop outline-none",
          // Mobile: bottom sheet. Desktop: centred dialog.
          "inset-x-0 bottom-0 rounded-t-2xl sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-[0.98]",
          width,
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <D.Title className="text-base font-semibold tracking-tight">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="-mr-1 grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("-mx-5 -mb-4 mt-5 flex flex-col-reverse gap-2 border-t border-border bg-surface-2/50 px-5 py-3 sm:flex-row sm:justify-end", className)}>{children}</div>;
}

/* ---------------------------------------------------------------- Sheet */

export function SheetContent({ title, children, side = "right" }: { title: string; children: React.ReactNode; side?: "right" | "bottom" }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col border-border bg-surface shadow-pop outline-none data-[state=open]:animate-in",
          side === "right" ? "inset-y-0 right-0 w-full max-w-md border-l data-[state=open]:slide-in-from-right" : "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t data-[state=open]:slide-in-from-bottom",
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <D.Title className="text-base font-semibold">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          <D.Close className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

/* --------------------------------------------------------- DropdownMenu */

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = "end", className }: { children: React.ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-surface p-1 text-sm shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ children, onSelect, danger, disabled, icon }: { children: React.ReactNode; onSelect?: (e: Event) => void; danger?: boolean; disabled?: boolean; icon?: React.ReactNode }) {
  return (
    <DM.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted",
        danger && "text-negative data-[highlighted]:bg-negative-soft [&_svg]:text-negative",
      )}
    >
      {icon}
      {children}
    </DM.Item>
  );
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <DM.Label className="px-2.5 py-1.5 text-xs text-muted">{children}</DM.Label>;
}

/* --------------------------------------------------------------- Tooltip */

export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Provider delayDuration={200}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded-md bg-text px-2.5 py-1.5 text-xs text-bg shadow-pop data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0">
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}

/* --------------------------------------------------------------- Popover */

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;

export function PopoverContent({ children, className, align = "end" }: { children: React.ReactNode; className?: string; align?: "start" | "center" | "end" }) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={8} className={cn("z-50 w-80 rounded-xl border border-border bg-surface shadow-pop outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", className)}>
        {children}
      </P.Content>
    </P.Portal>
  );
}

/* ------------------------------------------------------------------ Tabs */

export const Tabs = Tb.Root;
export const TabsContent = Tb.Content;

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Tb.List className={cn("inline-flex h-9 items-center gap-0.5 rounded-lg bg-surface-2 p-0.5 text-sm", className)}>{children}</Tb.List>;
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Tb.Trigger
      value={value}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 font-medium text-muted transition-colors hover:text-text data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-card"
    >
      {children}
    </Tb.Trigger>
  );
}

/* ---------------------------------------------------------------- Switch */

export function Switch({ checked, onCheckedChange, label, disabled, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <Sw.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-surface-3 transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
    >
      <Sw.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </Sw.Root>
  );
}

/* --------------------------------------------------------- Confirm dialog */

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} size="sm">
        <div className="text-sm text-text-2">{description}</div>
        <DialogFooter>
          <D.Close className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-surface px-3.5 text-sm font-medium hover:bg-surface-2">Cancel</D.Close>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "inline-flex h-9 items-center justify-center rounded-md px-3.5 text-sm font-medium disabled:opacity-50",
              danger ? "bg-negative text-white hover:opacity-90" : "bg-accent text-accent-fg hover:bg-accent-hover",
            )}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
