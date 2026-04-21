"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  PiggyBank,
  Settings,
  Sparkles,
  Wand2,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transazioni", label: "Transazioni", icon: ArrowLeftRight },
  { href: "/regole", label: "Regole IA", icon: Wand2 },
  { href: "/budget", label: "Budget", icon: PiggyBank },
  { href: "/impostazioni", label: "Impostazioni", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex md:flex-col md:w-64 shrink-0 border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)]/70 backdrop-blur-xl">
      <div className="px-6 pt-8 pb-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#0a84ff] to-[#5e5ce6] text-white shadow-sm">
            <Sparkles className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight">
              FamilyFinance
            </p>
            <p className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              AI
            </p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 px-3">
        <ul className="space-y-1">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={[
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors",
                    isActive
                      ? "bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]"
                      : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)]/60 hover:text-[color:var(--color-foreground)]",
                  ].join(" ")}
                >
                  <Icon
                    className={[
                      "h-[18px] w-[18px] transition-colors",
                      isActive
                        ? "text-[color:var(--color-accent)]"
                        : "text-[color:var(--color-muted-foreground)] group-hover:text-[color:var(--color-foreground)]",
                    ].join(" ")}
                    strokeWidth={2}
                  />
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="m-3 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[color:var(--color-accent)]" />
          <p className="text-[13px] font-semibold">Gemini AI</p>
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-[color:var(--color-muted-foreground)]">
          Categorizza automaticamente le tue transazioni grazie all&apos;IA.
        </p>
      </div>
    </aside>
  );
}
