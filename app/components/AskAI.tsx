"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Send,
  MessageSquareMore,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { FinanceTx } from "@/lib/gemini";
import type { Transaction } from "@/lib/mock-data";
import {
  formatRangeLabel,
  rangeToIsoBounds,
  type DateRange,
} from "@/lib/date-range";
import { CalendarClock } from "lucide-react";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; answer: string; question: string }
  | { kind: "error"; message: string };

type AskAIProps = {
  transactions: Transaction[];
  /**
   * Range temporale attualmente selezionato nella dashboard. Viene inviato
   * al backend come contesto per Gemini così che domande tipo "quanto ho
   * speso?" senza specificare il periodo vengano interpretate in modo
   * coerente con il filtro visibile.
   */
  dateRange?: DateRange | null;
};

const SUGGESTIONS = [
  "Quanto ho speso in ristoranti questo mese?",
  "Elenca i miei abbonamenti ricorrenti.",
  "Dammi 3 consigli per risparmiare.",
];

export default function AskAI({ transactions, dateRange = null }: AskAIProps) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function ask(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;

    setStatus({ kind: "loading" });

    const payload: FinanceTx[] = transactions.map((t) => ({
      description: t.description,
      amount: t.amount,
      category: t.category,
      date: t.date,
      tags: Array.isArray(t.tags) ? [...t.tags] : [],
      merchant:
        typeof t.merchant === "string" && t.merchant.trim()
          ? t.merchant.trim()
          : null,
    }));

    // Serializziamo il range come ISO bounds + label leggibile. Al backend
    // basterà inoltrarlo al prompt di Gemini per dare "senso del tempo"
    // alle domande ambigue ("quanto ho speso?" → nel periodo selezionato).
    const contextRange = dateRange
      ? {
          ...rangeToIsoBounds(dateRange),
          label: formatRangeLabel(dateRange),
        }
      : null;

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: trimmed,
          transactions: payload,
          dateRange: contextRange,
        }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      if (!res.ok || !data.answer) {
        throw new Error(data.error ?? "L'analisi non è riuscita.");
      }
      setStatus({ kind: "ready", answer: data.answer, question: trimmed });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Errore sconosciuto.",
      });
    }
  }

  const isLoading = status.kind === "loading";

  return (
    <section className="card-surface p-6 md:p-7">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0a84ff] to-[#5e5ce6] text-white shadow-sm">
            <MessageSquareMore className="h-5 w-5" strokeWidth={2} />
          </div>
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight">
              Chiedi all&apos;IA
            </h2>
            <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
              Analisi finanziaria in linguaggio naturale sui tuoi dati.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {dateRange ? (
            <span
              title="Periodo incluso nel contesto dell'analisi"
              className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-2.5 py-1 text-[11px] font-medium text-[color:var(--color-muted-foreground)]"
            >
              <CalendarClock className="h-3 w-3 text-[color:var(--color-accent)]" />
              {formatRangeLabel(dateRange)}
            </span>
          ) : null}
          <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)]/12 px-2.5 py-1 text-[11px] font-semibold text-[color:var(--color-accent)]">
            <Sparkles className="h-3 w-3" />
            Gemini
          </span>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(value);
        }}
        className="mt-5 flex items-center gap-2"
      >
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-11">
          <Sparkles className="h-4 w-4 text-[color:var(--color-accent)]" />
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Es. Quanto ho speso in ristoranti questo mese?"
            className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
            disabled={isLoading}
          />
        </div>
        <button
          type="submit"
          disabled={isLoading || !value.trim()}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-[color:var(--color-foreground)] px-4 text-[13px] font-semibold text-[color:var(--color-background)] transition-opacity disabled:opacity-50"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analisi in corso…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" strokeWidth={2.5} />
              Chiedi
            </>
          )}
        </button>
      </form>

      {status.kind === "idle" ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setValue(s);
                ask(s);
              }}
              className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-2.5 py-1 text-[11.5px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {status.kind === "loading" ? (
        <div className="mt-5 flex items-center gap-2 rounded-2xl bg-[color:var(--color-accent)]/8 px-4 py-4 text-[13px] text-[color:var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-accent)]" />
          <span>Analisi in corso…</span>
        </div>
      ) : null}

      {status.kind === "ready" ? (
        <AIAnswerBox question={status.question} answer={status.answer} />
      ) : null}

      {status.kind === "error" ? (
        <div className="mt-5 flex items-center gap-2 rounded-xl border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/8 px-3 py-2 text-[13px] text-[color:var(--color-expense)]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{status.message}</span>
        </div>
      ) : null}
    </section>
  );
}

function AIAnswerBox({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-[color:var(--color-accent)]/20 bg-gradient-to-br from-[color:var(--color-accent)]/8 to-[color:var(--color-accent)]/4 p-5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-accent)]">
        <Sparkles className="h-3.5 w-3.5" />
        AI Suggestion
      </div>
      <p className="mt-2 text-[13px] italic text-[color:var(--color-muted-foreground)]">
        &ldquo;{question}&rdquo;
      </p>
      <div className="ai-answer mt-3 text-[14px] leading-relaxed text-[color:var(--color-foreground)]">
        <ReactMarkdown>{answer}</ReactMarkdown>
      </div>
    </div>
  );
}
