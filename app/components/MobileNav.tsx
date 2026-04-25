"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Menu, X, LogOut, Sparkles, Shield, Terminal } from "lucide-react";
import { APP_MAIN_NAV_ITEMS } from "@/lib/app-nav";
import { getSupabaseClient } from "@/lib/supabase";
import type { User as SupabaseUser } from "@supabase/supabase-js";

function isAuthPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname === "/register" ||
    pathname.startsWith("/register/")
  );
}

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (isAuthPath(pathname)) return;
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
        const res = await fetch("/api/admin/log-badge", { credentials: "include" });
        const json = (await res.json().catch(() => null)) as { admin?: boolean } | null;
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
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const onLogout = useCallback(async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    setOpen(false);
    router.push("/login");
    router.refresh();
  }, [router]);

  if (isAuthPath(pathname)) return null;

  const displayName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    user?.email?.split("@")[0] ||
    "Account";

  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed left-4 top-4 z-[70] flex h-11 w-11 items-center justify-center rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]/95 text-[color:var(--color-foreground)] shadow-md backdrop-blur-md md:hidden"
        aria-label="Apri menu"
        aria-expanded={open}
      >
        <Menu className="h-5 w-5" strokeWidth={2} />
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[80] bg-black/45 md:hidden"
            aria-label="Chiudi menu"
            onClick={() => setOpen(false)}
          />
          <aside className="fixed left-0 top-0 z-[90] flex h-full w-[min(88vw,300px)] flex-col border-r border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-2xl md:hidden">
            <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#0a84ff] to-[#5e5ce6] text-white shadow-sm">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                </div>
                <span className="text-[14px] font-semibold tracking-tight">
                  FamilyFinance
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)]"
                aria-label="Chiudi"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              <ul className="space-y-0.5">
                {APP_MAIN_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                  const isActive =
                    href === "/" ? pathname === "/" : pathname.startsWith(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => setOpen(false)}
                        className={[
                          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors",
                          isActive
                            ? "bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]"
                            : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)]/70 hover:text-[color:var(--color-foreground)]",
                        ].join(" ")}
                      >
                        <Icon
                          className={[
                            "h-[18px] w-[18px]",
                            isActive
                              ? "text-[color:var(--color-accent)]"
                              : "text-[color:var(--color-muted-foreground)]",
                          ].join(" ")}
                          strokeWidth={2}
                        />
                        <span>{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {isAdmin ? (
                <div className="mt-4 border-t border-[color:var(--color-border)] pt-3">
                  <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                    Admin
                  </p>
                  <Link
                    href="/admin/logs"
                    onClick={() => setOpen(false)}
                    className={[
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors",
                      pathname.startsWith("/admin/logs")
                        ? "bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]"
                        : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)]/70 hover:text-[color:var(--color-foreground)]",
                    ].join(" ")}
                  >
                    <Shield
                      className={[
                        "h-[18px] w-[18px]",
                        pathname.startsWith("/admin/logs")
                          ? "text-[color:var(--color-accent)]"
                          : "text-[color:var(--color-muted-foreground)]",
                      ].join(" ")}
                      strokeWidth={2}
                    />
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span>System logs</span>
                      <span className="truncate text-[11px] font-normal text-[color:var(--color-muted-foreground)]">
                        Diagnostica · Gemini
                      </span>
                    </span>
                    <Terminal className="h-4 w-4 shrink-0 opacity-70" strokeWidth={2} />
                  </Link>
                </div>
              ) : null}
            </nav>

            <div className="border-t border-[color:var(--color-border)] p-3">
              <div className="flex items-center gap-2 rounded-xl bg-[color:var(--color-surface-muted)] px-2 py-2">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-surface)] text-[12px] font-semibold text-[color:var(--color-accent)] ring-1 ring-[color:var(--color-border)]"
                  aria-hidden
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold">{displayName}</p>
                  {user?.email ? (
                    <p className="truncate text-[10px] text-[color:var(--color-muted-foreground)]">
                      {user.email}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onLogout()}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[13px] font-medium transition-colors hover:bg-[color:var(--color-surface-muted)]"
              >
                <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
                Esci
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
