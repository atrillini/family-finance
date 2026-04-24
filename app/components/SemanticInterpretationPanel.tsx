"use client";

import { Sparkles } from "lucide-react";
import type { ParsedQuery } from "@/lib/gemini";
import {
  computeMonthlySummary,
  formatCurrency,
  type Transaction,
} from "@/lib/mock-data";

type Props = {
  active: ParsedQuery;
  /** Righe su cui calcolare i totali (stesso scope della query DB + periodo). */
  rows: readonly Transaction[];
  /** Se true, i totali possono essere diversi dalla tabella (filtro testuale header). */
  headerRefineActive?: boolean;
};

export default function SemanticInterpretationPanel({
  active,
  rows,
  headerRefineActive,
}: Props) {
  const summary = computeMonthlySummary([...rows]);
  const n = rows.length;

  return (
    <section
      className="card-surface border border-[color:var(--color-accent)]/20 p-4 md:p-5"
      aria-labelledby="semantic-interpretation-heading"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-accent)]/12 text-[color:var(--color-accent)]">
          <Sparkles className="h-4 w-4" strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2
              id="semantic-interpretation-heading"
              className="text-[14px] font-semibold tracking-tight text-[color:var(--color-foreground)]"
            >
              Ecco come ho interpretato…
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[color:var(--color-foreground)]">
              {active.explanation.trim() || "Filtro strutturato applicato."}
            </p>
            <p className="mt-2 rounded-lg bg-[color:var(--color-surface-muted)] px-2.5 py-1.5 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
              {active.filter.column} · {active.filter.operator} ·{" "}
              {String(active.filter.value)}
            </p>
          </div>

          <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/50 px-3 py-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
              Totali su questo risultato
            </p>
            <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-4">
              <div>
                <dt className="text-[11px] text-[color:var(--color-muted-foreground)]">
                  Movimenti
                </dt>
                <dd className="text-[15px] font-semibold tabular-nums">
                  {n}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-[color:var(--color-muted-foreground)]">
                  Entrate
                </dt>
                <dd className="text-[15px] font-semibold tabular-nums text-[color:var(--color-income)]">
                  {formatCurrency(summary.income)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-[color:var(--color-muted-foreground)]">
                  Uscite
                </dt>
                <dd className="text-[15px] font-semibold tabular-nums text-[color:var(--color-expense)]">
                  {formatCurrency(summary.expenses)}
                </dd>
              </div>
            </dl>
            {headerRefineActive ? (
              <p className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)]">
                La tabella sotto può mostrare meno righe se è attivo anche il
                filtro testuale dalla barra in alto.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
