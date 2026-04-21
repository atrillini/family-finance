"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  Search,
  X,
  AlertCircle,
} from "lucide-react";
import type { ParsedQuery } from "@/lib/gemini";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string };

type SmartSearchBarProps = {
  active: ParsedQuery | null;
  onApply: (parsed: ParsedQuery | null) => void;
};

const EXAMPLES = [
  "Spese sopra i 50 euro",
  "Acquisti da Netflix",
  "Tutte le entrate",
  "Transazioni con tag vacanza",
];

export default function SmartSearchBar({ active, onApply }: SmartSearchBarProps) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function runSearch(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;

    setStatus({ kind: "loading" });
    try {
      const res = await fetch("/api/translate-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = (await res.json()) as Partial<ParsedQuery> & {
        error?: string;
      };
      if (!res.ok || !data.filter) {
        throw new Error(data.error ?? "Non ho capito la richiesta.");
      }
      onApply({
        filter: data.filter,
        explanation: data.explanation ?? "",
      });
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Errore sconosciuto.",
      });
    }
  }

  function clear() {
    setValue("");
    setStatus({ kind: "idle" });
    onApply(null);
  }

  const isLoading = status.kind === "loading";

  return (
    <section className="card-surface p-4 md:p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0a84ff] to-[#5e5ce6] text-white">
          <Sparkles className="h-4 w-4" strokeWidth={2.5} />
        </div>

        <div className="flex-1 min-w-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              runSearch(value);
            }}
            className="flex items-center gap-2"
          >
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-10">
              <Search className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Chiedi in linguaggio naturale, es. 'spese sopra i 50 euro'…"
                className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
                disabled={isLoading}
              />
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-accent)]" />
              ) : value || active ? (
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Cancella ricerca"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={isLoading || !value.trim()}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--color-foreground)] px-4 text-[13px] font-semibold text-[color:var(--color-background)] transition-opacity disabled:opacity-50"
            >
              {isLoading ? "Penso…" : "Cerca"}
            </button>
          </form>
        </div>
      </div>

      {/* Pillole d'esempio – solo se non c'è una ricerca attiva */}
      {!active && status.kind !== "error" ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setValue(ex);
                runSearch(ex);
              }}
              disabled={isLoading}
              className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-2.5 py-1 text-[11.5px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)] disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      {/* Spiegazione di Gemini */}
      {active ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-[color:var(--color-accent)]/8 px-3 py-2 text-[12.5px] text-[color:var(--color-foreground)]">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--color-accent)]" />
          <div className="flex-1">
            <p>
              <span className="font-medium">Gemini:</span>{" "}
              {active.explanation || "Filtro applicato."}
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
              {active.filter.column} · {active.filter.operator} ·{" "}
              {String(active.filter.value)}
            </p>
          </div>
        </div>
      ) : null}

      {/* Errore */}
      {status.kind === "error" ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/8 px-3 py-2 text-[12.5px] text-[color:var(--color-expense)]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{status.message}</span>
        </div>
      ) : null}
    </section>
  );
}
