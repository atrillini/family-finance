"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Trash2 } from "lucide-react";
import type { SystemLogRow } from "@/lib/supabase";

function levelTextClass(level: SystemLogRow["level"]): string {
  if (level === "error") return "text-red-400";
  if (level === "success") return "text-emerald-400";
  return "text-zinc-300";
}

function fmtUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

export default function LogsClient() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [logs, setLogs] = useState<SystemLogRow[]>([]);
  const [cost30, setCost30] = useState(0);
  const [clearing, setClearing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/logs?limit=300", {
        credentials: "include",
      });
      if (res.status === 403) {
        setForbidden(true);
        setLogs([]);
        setCost30(0);
        return;
      }
      const json = (await res.json()) as {
        logs?: SystemLogRow[];
        costLast30DaysUsd?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Errore caricamento log");
      setForbidden(false);
      setLogs(json.logs ?? []);
      setCost30(Number(json.costLast30DaysUsd ?? 0));
    } catch {
      setForbidden(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function clearLogs() {
    if (
      !window.confirm(
        "Eliminare tutti i log di sistema per il tuo utente? L’operazione non è reversibile."
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      const res = await fetch("/api/admin/logs", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      await refresh();
    } finally {
      setClearing(false);
    }
  }

  if (forbidden && !loading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center text-[14px] text-zinc-400">
        <p className="font-medium text-zinc-200">Accesso negato</p>
        <p className="mt-2">
          Imposta <code className="font-mono text-[12px]">ADMIN_EMAIL</code>{" "}
          nel server (.env) uguale alla tua email utente, poi riprova.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-[13px] text-[color:var(--color-accent)] underline"
        >
          Torna alla dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 md:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Dev
          </p>
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-100">
            System Status &amp; Logs
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            Output stile terminale · sincronizzazione banca · Gemini · errori
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={clearing || loading}
            onClick={() => void clearLogs()}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[12.5px] font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {clearing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Clear Logs
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-[12.5px] font-medium text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            Aggiorna
          </button>
          <Link
            href="/"
            className="rounded-lg border border-zinc-700 px-3 py-2 text-[12.5px] font-medium text-zinc-400 hover:bg-zinc-900"
          >
            Home
          </Link>
        </div>
      </div>

      <div className="mb-4 rounded-xl border border-zinc-800 bg-black px-4 py-3 font-mono">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-[11px] uppercase tracking-wider text-zinc-600">
            Costi totali stimati (ultimi 30gg)
          </span>
          <span className="text-[15px] font-semibold text-amber-500/90 tabular-nums">
            {fmtUsd(cost30)}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
          Somma di <code className="text-zinc-500">estimated_cost</code> nei
          log (USD, da token Gemini). Prezzi configurabili con{" "}
          <code className="text-zinc-500">
            GEMINI_PRICE_INPUT_PER_1M_USD
          </code>{" "}
          /{" "}
          <code className="text-zinc-500">
            GEMINI_PRICE_OUTPUT_PER_1M_USD
          </code>
          .
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
          <span className="font-mono text-[11px] text-zinc-600">
            stream · system_logs
          </span>
          {loading ? (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              loading…
            </span>
          ) : (
            <span className="font-mono text-[11px] text-zinc-600">
              {logs.length} righe
            </span>
          )}
        </div>
        <div className="max-h-[min(70vh,640px)] overflow-y-auto overscroll-contain px-2 py-2">
          {logs.length === 0 && !loading ? (
            <p className="px-2 py-10 text-center font-mono text-[12px] text-zinc-600">
              Nessun log ancora. Esegui un sync o un’azione che chiami Gemini.
            </p>
          ) : (
            <ul className="space-y-0 font-mono text-[12px] leading-relaxed">
              {logs.map((row, i) => {
                const prefix = i % 2 === 0 ? "$" : ">";
                const ts = new Date(row.created_at).toISOString();
                const cost =
                  Number(row.estimated_cost ?? 0) > 0
                    ? ` · ~${fmtUsd(Number(row.estimated_cost))}`
                    : "";
                const tok =
                  row.tokens_input || row.tokens_output
                    ? ` · tok in ${row.tokens_input} / out ${row.tokens_output}`
                    : "";
                return (
                  <li
                    key={row.id}
                    className="border-b border-zinc-900/80 px-2 py-1.5 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="w-3 shrink-0 select-none text-zinc-700">
                        {prefix}
                      </span>
                      <span className="text-[9px] font-normal tracking-tight text-zinc-800/90">
                        {ts}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-zinc-700">
                        [{row.module}] [{row.level}]
                      </span>
                    </div>
                    <p
                      className={`mt-1 pl-5 ${levelTextClass(row.level)}`}
                    >
                      {row.message}
                      <span className="text-amber-600/80">{cost}</span>
                      <span className="text-zinc-600">{tok}</span>
                    </p>
                    {row.details &&
                    typeof row.details === "object" &&
                    Object.keys(row.details as object).length > 0 ? (
                      <pre className="mt-1 max-h-28 overflow-auto pl-5 text-[10px] leading-snug text-zinc-600">
                        {JSON.stringify(row.details, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
