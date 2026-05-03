import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  LineChart,
  Tags,
  Wand2,
  PiggyBank,
  TrendingUp,
  Settings,
} from "lucide-react";

export type AppNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** Voci principali (sidebar + menu mobile). */
export const APP_MAIN_NAV_ITEMS: AppNavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transazioni", label: "Transazioni", icon: ArrowLeftRight },
  { href: "/grafici", label: "Grafici", icon: LineChart },
  { href: "/analisi-tag", label: "Analisi tag", icon: Tags },
  { href: "/regole", label: "Regole IA", icon: Wand2 },
  { href: "/budget", label: "Budget", icon: PiggyBank },
  { href: "/investimenti", label: "Investimenti", icon: TrendingUp },
  { href: "/impostazioni", label: "Impostazioni", icon: Settings },
];
