import {
  ArrowLeftRight,
  Bot,
  CalendarClock,
  ChartColumn,
  Goal,
  Landmark,
  LayoutDashboard,
  PiggyBank,
  Settings,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  mobile?: boolean;
}

export const NAV: NavItem[] = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard, mobile: true },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, mobile: true },
  { href: "/budget", label: "Budget", icon: WalletCards, mobile: true },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/goals", label: "Savings goals", icon: PiggyBank },
  { href: "/recurring", label: "Recurring", icon: CalendarClock },
  { href: "/debt", label: "Debt", icon: Goal },
  { href: "/reports", label: "Reports", icon: ChartColumn },
  { href: "/assistant", label: "Assistant", icon: Bot, mobile: true },
  { href: "/settings", label: "Settings", icon: Settings },
];
