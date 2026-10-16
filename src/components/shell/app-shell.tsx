"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { ChevronsLeft, ChevronsRight, LogOut, Menu as MenuIcon, Monitor, Moon, Plus, Sun, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo, LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/primitives";
import { Dialog, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, SheetContent, Tooltip } from "@/components/ui/overlay";
import { authClient } from "@/lib/auth-client";
import { NAV } from "./nav";
import { NotificationsButton } from "./notifications";
import { QuickAddProvider, useQuickAdd } from "@/components/transactions/quick-add";
import type { PickerData } from "@/components/transactions/types";

const COLLAPSE_KEY = "ledger.sidebar.collapsed";

const collapseListeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false; // storage unavailable
  }
}

/** Sidebar preference in localStorage (a per-device convenience, never required). */
function useCollapsed(): [boolean, (v: boolean) => void] {
  const collapsed = React.useSyncExternalStore(
    (cb) => {
      collapseListeners.add(cb);
      return () => collapseListeners.delete(cb);
    },
    readCollapsed,
    () => false,
  );
  return [
    collapsed,
    (v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
      } catch {
        /* storage unavailable */
      }
      collapseListeners.forEach((l) => l());
    },
  ];
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children, user, pickers, unread }: { children: React.ReactNode; user: { name: string; email: string }; pickers: PickerData; unread: number }) {
  return (
    <QuickAddProvider pickers={pickers}>
      <ShellInner user={user} unread={unread}>
        {children}
      </ShellInner>
    </QuickAddProvider>
  );
}

function ShellInner({ children, user, unread }: { children: React.ReactNode; user: { name: string; email: string }; unread: number }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useCollapsed();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const { open: openQuickAdd } = useQuickAdd();

  // Keyboard shortcut: "n" opens quick add (when not typing in a field).
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        openQuickAdd();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openQuickAdd]);

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>

      {/* Desktop / tablet sidebar */}
      <aside
        className={cn(
          "no-print sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface/60 transition-[width] duration-200 md:flex",
          collapsed ? "w-[68px]" : "w-60",
        )}
        aria-label="Main navigation"
      >
        <div className={cn("flex h-14 items-center", collapsed ? "justify-center" : "px-5")}>
          <Link href="/overview" aria-label="Ledger home">
            <Logo collapsed={collapsed} />
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const link = (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-9 items-center gap-3 rounded-md px-2.5 text-[13.5px] font-medium transition-colors",
                  active ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2/70 hover:text-text",
                  collapsed && "justify-center px-0",
                )}
              >
                <item.icon className={cn("size-[18px] shrink-0", active ? "text-accent" : "text-muted group-hover:text-text-2")} aria-hidden />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {collapsed && <span className="sr-only">{item.label}</span>}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.href} content={item.label} side="right">
                {link}
              </Tooltip>
            ) : (
              link
            );
          })}
        </nav>
        <div className={cn("border-t border-border p-3", collapsed && "flex justify-center")}>
          <Button variant="ghost" size={collapsed ? "icon-sm" : "sm"} className={cn(!collapsed && "w-full justify-start")} onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
            {!collapsed && "Collapse"}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg/70 md:px-6">
          <Link href="/overview" className="md:hidden" aria-label="Ledger home">
            <LogoMark />
          </Link>
          <div className="flex-1" />
          <Button variant="primary" size="sm" onClick={() => openQuickAdd()} className="hidden sm:inline-flex" aria-keyshortcuts="n">
            <Plus /> Add transaction
          </Button>
          <NotificationsButton initialUnread={unread} />
          <UserMenu user={user} />
        </header>

        <main id="main" className="flex-1 px-4 pb-28 pt-5 md:px-6 md:pb-10 lg:px-8">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Main navigation">
        <div className="grid grid-cols-5">
          {NAV.filter((n) => n.mobile)
            .slice(0, 2)
            .map((item) => (
              <MobileTab key={item.href} href={item.href} label={item.label === "Transactions" ? "Activity" : item.label} icon={item.icon} active={isActive(pathname, item.href)} />
            ))}
          <div className="flex items-center justify-center">
            <button onClick={() => openQuickAdd()} className="grid size-12 -translate-y-3 place-items-center rounded-full bg-accent text-accent-fg shadow-pop" aria-label="Add transaction">
              <Plus className="size-6" />
            </button>
          </div>
          {NAV.filter((n) => n.mobile)
            .slice(2, 3)
            .map((item) => (
              <MobileTab key={item.href} href={item.href} label={item.label} icon={item.icon} active={isActive(pathname, item.href)} />
            ))}
          <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
            <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-1 py-2 text-[11px] font-medium text-muted" aria-label="More destinations">
              <MenuIcon className="size-5" />
              More
            </button>
            <SheetContent title="More" side="bottom">
              <div className="grid grid-cols-3 gap-2 p-4">
                {NAV.filter((n) => !["/overview", "/transactions", "/budget"].includes(n.href)).map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn("flex flex-col items-center gap-2 rounded-xl border border-border p-3 text-center text-xs font-medium", isActive(pathname, item.href) ? "bg-accent-soft text-accent" : "bg-surface")}
                  >
                    <item.icon className="size-5" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </SheetContent>
          </Dialog>
        </div>
      </nav>
    </div>
  );
}

function MobileTab({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-1 py-2 text-[11px] font-medium", active ? "text-accent" : "text-muted")}>
      <Icon className="size-5" />
      {label}
    </Link>
  );
}

function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="grid size-9 place-items-center rounded-full bg-surface-3 text-[12px] font-semibold text-text-2 hover:ring-2 hover:ring-border" aria-label="Account menu">
          {initials || <User className="size-4" />}
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>
          <span className="block font-medium text-text">{user.name}</span>
          <span className="block truncate">{user.email}</span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem icon={<User />} onSelect={() => router.push("/settings")}>
          Settings
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        {(
          [
            ["light", "Light", Sun],
            ["dark", "Dark", Moon],
            ["system", "System", Monitor],
          ] as const
        ).map(([value, label, Icon]) => (
          <MenuItem key={value} icon={<Icon />} onSelect={() => setTheme(value)}>
            {label}
            {theme === value && <span className="ml-auto text-accent">✓</span>}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem
          icon={<LogOut />}
          onSelect={async () => {
            await authClient.signOut();
            router.replace("/sign-in");
            router.refresh();
          }}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
