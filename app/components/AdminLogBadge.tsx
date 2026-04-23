"use client";

import { useEffect, useState } from "react";

/**
 * ⚠️ se l’ultimo system_log dell’admin è `error`.
 * Visibile solo se `ADMIN_EMAIL` coincide con l’utente loggato.
 */
export default function AdminLogBadge() {
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/admin/log-badge", {
          credentials: "include",
        });
        const json = (await res.json()) as {
          admin?: boolean;
          lastLogIsError?: boolean;
        };
        if (cancelled) return;
        if (json.admin && json.lastLogIsError) setWarn(true);
        else setWarn(false);
      } catch {
        if (!cancelled) setWarn(false);
      }
    }
    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (!warn) return null;

  return (
    <span
      className="inline-flex h-8 min-w-[2rem] items-center justify-center text-[15px] leading-none"
      title="Ultimo log di sistema: errore — vedi /admin/logs"
      aria-hidden
    >
      ⚠️
    </span>
  );
}
