"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Info, TrendingUp, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { dismissInsightAction } from "@/server/actions/finance";
import type { Insight } from "@/domain/insights";

export function InsightList({ insights }: { insights: Insight[] }) {
  const router = useRouter();
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const visible = insights.filter((i) => !hidden.has(i.key));
  if (!visible.length) return <p className="text-sm text-muted">Nothing else needs your attention right now.</p>;
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {visible.map((i) => {
        const Icon = i.severity === "warning" ? AlertTriangle : i.severity === "positive" ? TrendingUp : Info;
        return (
          <li key={i.key} className="card flex flex-col p-4">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full",
                  i.severity === "warning" ? "bg-warning-soft text-warning" : i.severity === "positive" ? "bg-accent-soft text-positive" : "bg-info-soft text-info",
                )}
              >
                <Icon className="size-4" aria-label={i.severity} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug">{i.title}</p>
                <p className="mt-1 text-[13px] text-text-2">{i.body}</p>
              </div>
              <button
                className="-mr-1 -mt-1 rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
                aria-label={`Dismiss: ${i.title}`}
                onClick={async () => {
                  setHidden((s) => new Set(s).add(i.key));
                  const r = await dismissInsightAction({ key: i.key });
                  if (!r.ok) {
                    toast.error(r.error);
                    setHidden((s) => {
                      const n = new Set(s);
                      n.delete(i.key);
                      return n;
                    });
                  } else router.refresh();
                }}
              >
                <X className="size-4" />
              </button>
            </div>
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer select-none hover:text-text">Why am I seeing this?</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {i.reasoning.map((r, n) => (
                  <li key={n}>{r}</li>
                ))}
              </ul>
            </details>
            <div className="mt-auto flex items-center justify-between pt-3">
              <Badge tone="outline">{i.basis === "fact" ? "From your transactions" : "Estimate"}</Badge>
              {i.href && (
                <Link href={i.href} className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
                  Look into it <ArrowRight className="size-3.5" />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
