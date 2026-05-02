"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  CheckCircle2,
  Info,
  TriangleAlert,
} from "lucide-react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import SkeletonGlow from "./premium/SkeletonGlow";
import type { RealtimeChannel } from "@supabase/supabase-js";

type NotifRow = {
  id: string;
  type: "info" | "warning" | "success";
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
};

function TypeIcon({ type }: { type: NotifRow["type"] }) {
  const cls = "h-3.5 w-3.5 shrink-0 opacity-70";
  if (type === "warning")
    return <TriangleAlert className={[cls, "text-amber-400/90"].join(" ")} />;
  if (type === "success")
    return <CheckCircle2 className={[cls, "text-emerald-400/90"].join(" ")} />;
  return <Info className={[cls, "text-zinc-400"].join(" ")} />;
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 1) return "Adesso";
    if (mins < 60) return `${mins} min fa`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h fa`;
    return d.toLocaleDateString("it-IT", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return "";
  }
}

export default function NotificationsBell() {
  const configured = isSupabaseConfigured();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotifRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [bellWiggle, setBellWiggle] = useState(0);
  const prevUnread = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async () => {
    if (!configured) return;
    try {
      const res = await fetch(
        "/api/notifications?limit=40&warmConsent=1",
        { credentials: "include" }
      );
      if (!res.ok) return;
      const json = (await res.json()) as {
        notifications?: NotifRow[];
        unreadCount?: number;
      };
      setItems(json.notifications ?? []);
      setUnread(Number(json.unreadCount ?? 0));
    } catch {
      /* ignore */
    }
  }, [configured]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (reduceMotion) {
      prevUnread.current = unread;
      return;
    }
    if (
      prevUnread.current !== null &&
      unread > prevUnread.current
    ) {
      setBellWiggle((n) => n + 1);
    }
    prevUnread.current = unread;
  }, [unread, reduceMotion]);

  // Realtime: richiede `supabase_realtime` sulla tabella `notifications`
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const supabase = getSupabaseClient();
    let channel: RealtimeChannel | null = null;

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
      channel = supabase
        .channel(`notifications:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void refresh();
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [configured, refresh]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [open, refresh]);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ids }),
    });
    await refresh();
  }

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ markAllRead: true }),
    });
    await refresh();
  }

  if (!configured) {
    return (
      <button
        type="button"
        aria-label="Notifiche"
        disabled
        className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] opacity-50"
      >
        <Bell className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label="Notifiche"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
      >
        <motion.span
          key={bellWiggle}
          className="inline-flex"
          initial={{ rotate: 0 }}
          animate={
            reduceMotion || bellWiggle === 0
              ? { rotate: 0 }
              : { rotate: [0, -16, 14, -10, 7, 0] }
          }
          transition={{ duration: 0.52, ease: "easeInOut" }}
        >
          <Bell className="h-4 w-4" />
        </motion.span>
        {unread > 0 ? (
          <span
            className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[color:var(--color-expense)] px-[5px] text-[10px] font-semibold leading-none text-white"
            aria-live="polite"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : (
          <span className="sr-only">Nessuna notifica non letta</span>
        )}
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="absolute right-0 top-[calc(100%+8px)] z-[80] w-[min(380px,calc(100vw-48px))] overflow-hidden rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-[color:var(--color-border)] px-3 py-2.5">
            <span className="text-[13px] font-semibold tracking-tight">
              Notifiche
            </span>
            {items.some((n) => !n.is_read) ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-[11.5px] font-medium text-[color:var(--color-accent)] hover:underline"
              >
                Segna tutte lette
              </button>
            ) : null}
          </div>

          <div className="max-h-[min(70vh,420px)] overflow-y-auto">
            {loading ? (
              <div className="space-y-3 px-3 py-6">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-2.5">
                    <SkeletonGlow className="h-9 w-9 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1 space-y-2 pt-0.5">
                      <SkeletonGlow className="h-3.5 w-[72%] max-w-[220px] rounded-md" />
                      <SkeletonGlow className="h-3 w-full max-w-[280px] rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-10 text-center text-[12.5px] text-[color:var(--color-muted-foreground)]">
                Nessuna notifica al momento.
              </p>
            ) : (
              <ul className="divide-y divide-[color:var(--color-border)]">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!n.is_read) void markRead([n.id]);
                      }}
                      className={[
                        "flex w-full gap-2.5 px-3 py-3 text-left transition-colors hover:bg-[color:var(--color-surface-muted)]/60",
                        n.is_read ? "opacity-75" : "bg-[color:var(--color-surface-muted)]/25",
                      ].join(" ")}
                    >
                      <TypeIcon type={n.type} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-[13px] font-medium leading-snug text-[color:var(--color-foreground)]">
                            {n.title}
                          </span>
                          <span className="shrink-0 text-[10px] text-[color:var(--color-muted-foreground)]">
                            {formatWhen(n.created_at)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-[color:var(--color-muted-foreground)]">
                          {n.message}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
