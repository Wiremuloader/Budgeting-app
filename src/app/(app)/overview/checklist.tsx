"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Progress } from "@/components/ui/primitives";
import { dismissChecklistAction } from "@/server/actions/settings";

export function Checklist({ items, done, total }: { items: { key: string; label: string; done: boolean; href: string }[]; done: number; total: number }) {
  const router = useRouter();
  return (
    <Card className="mb-6 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">Finish setting up</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {done} of {total} done — each step makes your numbers more accurate.
          </p>
        </div>
        <button
          className="rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Hide setup checklist"
          onClick={async () => {
            await dismissChecklistAction();
            router.refresh();
          }}
        >
          <X className="size-4" />
        </button>
      </div>
      <Progress value={done} max={total} className="mt-3" label="Setup progress" />
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <li key={i.key}>
            <Link
              href={i.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
                i.done ? "border-transparent bg-surface-2 text-muted line-through" : "border-border hover:border-accent hover:bg-accent-soft/40",
              )}
            >
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", i.done ? "border-accent bg-accent text-accent-fg" : "border-border-strong")}>
                {i.done && <Check className="size-3" />}
              </span>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
