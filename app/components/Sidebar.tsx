"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  PiggyBank,
  Settings,
  Sparkles,
  Wand2,
  LogOut,
  Terminal,
  Shield,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transazioni", label: "Transazioni", icon: ArrowLeftRight },
  { href: "/regole", label: "Regole IA", icon: Wand2 },
  { href: "/budget", label: "Budget", icon: PiggyBank },
  { href: "/impostazioni", label: "Impostazioni", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();

    async function refreshUserAndAdmin() {
      const { data } = await supabase.auth.getUser();
      const nextUser = data.user ?? null;
      setUser(nextUser);
      if (!nextUser) {
        setIsAdmin(false);
        return;
      }
      try {
        const res = await fetch("/api/admin/log-badge", {
          credentials: "include",
        });
        const json = (await res.json().catch(() => null)) as {
          admin?: boolean;
        } | null;
        setIsAdmin(Boolean(json?.admin));
      } catch {
        setIsAdmin(false);
      }
    }

    void refreshUserAndAdmin();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refreshUserAndAdmin();
    });
    return () => subscription.unsubscribe();
  }, []);

  const displayName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    user?.email?.split("@")[0] ||
    "Account";

  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

  const onLogout = useCallback(async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }, [router]);

  return (
    <aside className="hidden md:flex md:flex-col md:min-h-screen md:w-64 shrink-0 border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)]/70 backdrop-blur-xl">
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

      <nav className="flex-1 min-h-0 px-3">
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

          {isAdmin ? (
            <>
              <li className="pt-4 pb-1">
                <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                  Admin
                </p>
              </li>
              <li>
                <Link
                  href="/admin/logs"
                  className={[
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors",
                    pathname.startsWith("/admin/logs")
                      ? "bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]"
                      : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)]/60 hover:text-[color:var(--color-foreground)]",
                  ].join(" ")}
                >
                  <Shield
                    className={[
                      "h-[18px] w-[18px] transition-colors",
                      pathname.startsWith("/admin/logs")
                        ? "text-[color:var(--color-accent)]"
                        : "text-[color:var(--color-muted-foreground)] group-hover:text-[color:var(--color-foreground)]",
                    ].join(" ")}
                    strokeWidth={2}
                  />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span>System logs</span>
                    <span className="truncate text-[11px] font-normal text-[color:var(--color-muted-foreground)]">
                      Diagnostica · Gemini
                    </span>
                  </span>
                  <Terminal
                    className="h-4 w-4 shrink-0 text-[color:var(--color-muted-foreground)] opacity-70"
                    strokeWidth={2}
                  />
                </Link>
              </li>
            </>
          ) : null}
        </ul>
      </nav>

      <div className="mt-auto space-y-3 px-3 pb-6 pt-2">
        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] p-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-surface)] text-[13px] font-semibold text-[color:var(--color-accent)] ring-1 ring-[color:var(--color-border)]"
              aria-hidden
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-tight">
                {displayName}
              </p>
              {user?.email ? (
                <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                  {user.email}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
            Esci
          </button>
        </div>

        <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] p-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[color:var(--color-accent)]" />
            <p className="text-[13px] font-semibold">Gemini AI</p>
          </div>
          <p className="mt-1.5 text-[12px] leading-snug text-[color:var(--color-muted-foreground)]">
            Categorizza automaticamente le tue transazioni grazie all&apos;IA.
          </p>
        </div>
      </div>
    </aside>
  );
}
