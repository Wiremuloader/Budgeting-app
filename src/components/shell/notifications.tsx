"use client";

import * as React from "react";
import Link from "next/link";
import { Bell, CheckCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlay";
import { Button, EmptyState, Skeleton } from "@/components/ui/primitives";
import { dismissNotificationAction, markNotificationsReadAction, notificationsAction } from "@/server/actions/settings";

type Item = { id: string; title: string; body: string; href: string | null; severity: string; read: boolean; createdAt: string };

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function NotificationsButton({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [unread, setUnread] = React.useState(initialUnread);
  const [error, setError] = React.useState<string | null>(null);

  const [seenInitial, setSeenInitial] = React.useState(initialUnread);
  if (seenInitial !== initialUnread) {
    setSeenInitial(initialUnread);
    setUnread(initialUnread);
  }

  async function load() {
    setError(null);
    const r = await notificationsAction();
    if (r.ok) {
      setItems(r.data.items);
      setUnread(r.data.unread);
    } else setError(r.error);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <PopoverTrigger asChild>
        <button className="relative grid size-9 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell className="size-[18px]" />
          {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-negative ring-2 ring-bg" aria-hidden />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await markNotificationsReadAction({});
                  setUnread(0);
                  setItems((xs) => xs?.map((x) => ({ ...x, read: true })) ?? null);
                }}
              >
                <CheckCheck /> Mark all read
              </Button>
            )}
            <Link href="/settings?tab=notifications" className="text-xs text-accent hover:underline" onClick={() => setOpen(false)}>
              Settings
            </Link>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {error && <p className="p-4 text-sm text-negative">{error}</p>}
          {!items && !error && (
            <div className="space-y-3 p-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          )}
          {items && items.length === 0 && <EmptyState icon={<Bell />} title="You're all caught up" className="py-10" />}
          {items?.map((n) => (
            <div key={n.id} className={cn("group relative flex gap-3 border-b border-border px-4 py-3 last:border-0", !n.read && "bg-accent-soft/40")}>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.severity === "warning" ? "bg-warning" : n.severity === "positive" ? "bg-positive" : "bg-info")} aria-hidden />
              <div className="min-w-0 flex-1">
                {n.href ? (
                  <Link href={n.href} onClick={() => setOpen(false)} className="text-sm font-medium hover:underline">
                    {n.title}
                  </Link>
                ) : (
                  <p className="text-sm font-medium">{n.title}</p>
                )}
                <p className="mt-0.5 text-[13px] text-muted">{n.body}</p>
                <p className="mt-1 text-[11px] text-muted">{timeAgo(n.createdAt)}</p>
              </div>
              <button
                className="h-6 shrink-0 rounded p-1 text-muted opacity-0 hover:bg-surface-2 focus:opacity-100 group-hover:opacity-100"
                aria-label="Dismiss notification"
                onClick={async () => {
                  await dismissNotificationAction({ id: n.id });
                  setItems((xs) => xs?.filter((x) => x.id !== n.id) ?? null);
                  if (!n.read) setUnread((u) => Math.max(u - 1, 0));
                }}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
