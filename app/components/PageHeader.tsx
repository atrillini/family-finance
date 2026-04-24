"use client";

import { useEffect, useMemo, useState } from "react";
import AdminLogBadge from "./AdminLogBadge";
import HeaderWeather from "./HeaderWeather";
import NotificationsBell from "./NotificationsBell";
import { formatRelativeShort } from "@/lib/format-relative-it";
import { isSupabaseConfigured } from "@/lib/supabase";

function timeOfDayGreetingRome(): string {
  const hour = Number(
    new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome",
      hour: "numeric",
      hour12: false,
    })
      .formatToParts(new Date())
      .find((p) => p.type === "hour")?.value ?? "12"
  );
  if (hour >= 5 && hour < 12) return "Buongiorno";
  if (hour >= 12 && hour < 18) return "Buon pomeriggio";
  if (hour >= 18 && hour < 22) return "Buonasera";
  return "Buonanotte";
}

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  /** Iniziali se manca `avatarUrl`. */
  avatarInitials?: string;
  /** URL immagine profilo (es. OAuth `picture` / `avatar_url`). */
  avatarUrl?: string | null;
  /** Se true, mostra una riga di saluto in base all'ora (Europe/Rome). */
  showTimeGreeting?: boolean;
  /**
   * ISO dell'ultimo sync tra i conti. Se omesso e Supabase è configurato,
   * viene richiesto a `/api/accounts/last-sync` lato client.
   */
  lastSyncAtIso?: string | null;
};

export default function PageHeader({
  title,
  subtitle,
  avatarInitials = "??",
  avatarUrl = null,
  showTimeGreeting = true,
  lastSyncAtIso: lastSyncProp,
}: PageHeaderProps) {
  const greeting = useMemo(() => timeOfDayGreetingRome(), []);
  const [lastSyncIso, setLastSyncIso] = useState<string | null | undefined>(
    lastSyncProp
  );

  useEffect(() => {
    setLastSyncIso(lastSyncProp);
  }, [lastSyncProp]);

  useEffect(() => {
    if (lastSyncProp !== undefined) return;
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/accounts/last-sync", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { lastSyncAt?: string | null };
        if (!cancelled) setLastSyncIso(json.lastSyncAt ?? null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastSyncProp]);

  const lastSyncLabel =
    typeof lastSyncIso === "string" && lastSyncIso
      ? `Sync banche · ${formatRelativeShort(lastSyncIso)}`
      : null;

  const avatarImg =
    typeof avatarUrl === "string" && avatarUrl.startsWith("https://")
      ? avatarUrl
      : null;

  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {showTimeGreeting ? (
          <p className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            {greeting}
          </p>
        ) : null}
        <h1
          className={[
            "text-[28px] md:text-[32px] font-semibold tracking-tight",
            showTimeGreeting ? "mt-0.5" : "",
          ].join(" ")}
        >
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-[14px] text-[color:var(--color-muted-foreground)]">
            {subtitle}
          </p>
        ) : null}
        {lastSyncLabel ? (
          <p className="mt-1.5 text-[12px] text-[color:var(--color-muted-foreground)]">
            {lastSyncLabel}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <AdminLogBadge />
        <HeaderWeather />
        <NotificationsBell />
        {avatarImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarImg}
            alt=""
            width={36}
            height={36}
            referrerPolicy="no-referrer"
            className="h-9 w-9 rounded-full border border-[color:var(--color-border)] object-cover"
          />
        ) : (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#5e5ce6] to-[#0a84ff] text-[12px] font-semibold text-white"
            aria-hidden
          >
            {avatarInitials.slice(0, 3)}
          </div>
        )}
      </div>
    </header>
  );
}
