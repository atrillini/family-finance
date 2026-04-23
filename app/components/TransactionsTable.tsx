"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ShoppingBag,
  UtensilsCrossed,
  Car,
  Home,
  Zap,
  HeartPulse,
  GraduationCap,
  Gamepad2,
  Shirt,
  Plane,
  Banknote,
  PiggyBank,
  CircleDot,
  Repeat,
  Sparkles,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowRightLeft,
  Check,
  type LucideIcon,
} from "lucide-react";
import {
  formatCurrency,
  formatDate,
  shortenDescription,
  type Transaction,
} from "@/lib/mock-data";
import type { TransactionCategory } from "@/lib/gemini";
import TransactionSearchBar from "./TransactionSearchBar";

const CATEGORY_ICONS: Record<TransactionCategory, LucideIcon> = {
  Alimentari: ShoppingBag,
  Ristoranti: UtensilsCrossed,
  Trasporti: Car,
  Casa: Home,
  Bollette: Zap,
  Salute: HeartPulse,
  Istruzione: GraduationCap,
  Svago: Gamepad2,
  Abbigliamento: Shirt,
  Viaggi: Plane,
  Stipendio: Banknote,
  Risparmio: PiggyBank,
  Altro: CircleDot,
};

/** Opzioni per il selettore di "righe per pagina". */
const PAGE_SIZE_OPTIONS = [20, 30, 50, 100] as const;

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

type TransactionsTableProps = {
  transactions: Transaction[];
  title?: string;
  /**
   * Quando fornito, ogni riga diventa cliccabile e richiama la callback
   * con la transazione selezionata (tipicamente per aprire un modal di edit).
   */
  onRowClick?: (tx: Transaction) => void;
  /**
   * Quando fornito, i badge di categoria diventano cliccabili e richiamano
   * la callback con il nome della categoria (tipicamente per popolare la
   * barra di ricerca). Il click si ferma a livello badge, senza aprire il
   * modal della riga.
   */
  onCategoryClick?: (category: string) => void;
  /** Come `onCategoryClick`, ma per i singoli tag. */
  onTagClick?: (tag: string) => void;
  /**
   * Quando fornito, ogni riga mostra un pulsante "IA" per richiedere a
   * Gemini di ri-categorizzare la transazione. Il parent gestisce la chiamata
   * ad `/api/recategorize` e l'eventuale toast di errore.
   */
  onRecategorize?: (tx: Transaction) => void | Promise<void>;
  /** ID delle transazioni per cui è in corso la ricategorizzazione AI. */
  recategorizingIds?: Set<string>;
  /** Numero di righe per pagina di default. */
  defaultPageSize?: number;
  /**
   * Abilita la selezione multipla: compare una colonna di checkbox e una
   * checkbox "select all" nell'header. Il parent gestisce le azioni massive
   * via `selectedIds` + `onSelectionChange`.
   */
  selectable?: boolean;
  /** Set di id attualmente selezionati (parent-controlled). */
  selectedIds?: Set<string>;
  /** Callback per aggiornare la selezione. */
  onSelectionChange?: (next: Set<string>) => void;
  /** Campo ricerca transazioni (contesto globale) nell’header della card. */
  showTransactionSearch?: boolean;
  /** Tag distinti dal dataset per autocompletamento nella barra ricerca (come `BulkActionsBar`). */
  tagSuggestions?: string[];
};

export default function TransactionsTable({
  transactions,
  title = "Ultime transazioni",
  onRowClick,
  onCategoryClick,
  onTagClick,
  onRecategorize,
  recategorizingIds,
  defaultPageSize = 25,
  selectable = false,
  selectedIds,
  onSelectionChange,
  showTransactionSearch = true,
  tagSuggestions = [],
}: TransactionsTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(defaultPageSize);

  const total = transactions.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Se dopo un filtro il numero totale di pagine si riduce sotto la pagina
  // corrente, scaliamo per non mostrare una tabella vuota.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Quando cambia la dimensione del dataset (tipicamente per un filtro
  // esterno), torniamo a pagina 1 così l'utente vede subito i risultati.
  useEffect(() => {
    setPage(1);
  }, [total]);

  const pageStart = (page - 1) * pageSize;
  const pageEnd = Math.min(pageStart + pageSize, total);
  const pageRows = useMemo(
    () => transactions.slice(pageStart, pageEnd),
    [transactions, pageStart, pageEnd]
  );

  const selection = selectedIds ?? EMPTY_SELECTION;
  const pageIds = useMemo(() => pageRows.map((r) => r.id), [pageRows]);
  const allPageSelected =
    selectable && pageIds.length > 0 && pageIds.every((id) => selection.has(id));
  const somePageSelected =
    selectable && !allPageSelected && pageIds.some((id) => selection.has(id));

  function toggleOne(id: string) {
    if (!onSelectionChange) return;
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  function toggleAllOnPage() {
    if (!onSelectionChange) return;
    const next = new Set(selection);
    if (allPageSelected) {
      for (const id of pageIds) next.delete(id);
    } else {
      for (const id of pageIds) next.add(id);
    }
    onSelectionChange(next);
  }

  // Il numero di colonne varia a seconda delle opzioni abilitate; lo
  // calcoliamo qui così l'empty-state e il colSpan restano coerenti senza
  // ginnastica condizionale inline.
  const columnsCount =
    4 + (selectable ? 1 : 0) + (onRecategorize ? 1 : 0);

  return (
    <section className="card-surface overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-[color:var(--color-border)] px-4 py-4 sm:px-5 md:px-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
          <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
            Aggiornate in tempo reale · {total}{" "}
            {total === 1 ? "movimento" : "movimenti"}
            {total > pageSize
              ? ` · mostrati ${pageStart + 1}-${pageEnd}`
              : ""}
          </p>
        </div>
        {showTransactionSearch ? (
          <TransactionSearchBar
            className="w-full shrink-0 sm:w-auto sm:max-w-sm sm:pt-0.5"
            tagSuggestions={tagSuggestions}
          />
        ) : null}
      </div>

      {/*
        Tabella responsive: manteniamo overflow-x-auto come rete di
        sicurezza, ma nascondiamo via CSS le colonne secondarie sulle
        viewport strette (Data sotto `sm`, Categoria sotto `md`). Le
        informazioni nascoste vengono rimostrate inline sotto la
        descrizione, così nessun dato si perde su mobile.
      */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-[color:var(--color-muted-foreground)] bg-[color:var(--color-surface-muted)]/40">
              {selectable ? (
                <th className="pl-3 pr-1.5 sm:pl-4 sm:pr-2 py-3 w-8">
                  <HeaderCheckbox
                    checked={allPageSelected}
                    indeterminate={somePageSelected}
                    onChange={toggleAllOnPage}
                    label={
                      allPageSelected
                        ? "Deseleziona pagina"
                        : "Seleziona tutta la pagina"
                    }
                  />
                </th>
              ) : null}
              <th className="px-3 sm:px-4 md:px-6 py-3 font-medium">
                Descrizione
              </th>
              <th className="hidden md:table-cell px-3 sm:px-4 md:px-6 py-3 font-medium">
                Categoria
              </th>
              <th className="hidden sm:table-cell px-3 sm:px-4 md:px-6 py-3 font-medium">
                Data
              </th>
              <th className="px-3 sm:px-4 md:px-6 py-3 font-medium text-right">
                Importo
              </th>
              {onRecategorize ? (
                <th className="px-2 sm:px-3 md:px-4 py-3 font-medium text-right">
                  IA
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((t, i) => {
              const Icon = CATEGORY_ICONS[t.category] ?? CircleDot;
              const isIncome = t.amount >= 0;
              const clickable = Boolean(onRowClick);
              const isRecategorizing = Boolean(
                recategorizingIds?.has(t.id)
              );
              const isSelected = selection.has(t.id);
              return (
                <tr
                  key={t.id}
                  onClick={clickable ? () => onRowClick!(t) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onRowClick!(t);
                          }
                        }
                      : undefined
                  }
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? "button" : undefined}
                  aria-label={
                    clickable
                      ? `Modifica ${shortenDescription(t.description, t.merchant)}`
                      : undefined
                  }
                  className={[
                    "group transition-colors hover:bg-[color:var(--color-surface-muted)]/50",
                    clickable
                      ? "cursor-pointer focus:outline-none focus-visible:bg-[color:var(--color-surface-muted)]/60"
                      : "",
                    i < pageRows.length - 1
                      ? "border-b border-[color:var(--color-border)]"
                      : "",
                    isSelected ? "bg-[color:var(--color-accent)]/5" : "",
                  ].join(" ")}
                >
                  {selectable ? (
                    <td
                      className="pl-3 pr-1.5 sm:pl-4 sm:pr-2 py-4 w-8"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <RowCheckbox
                        checked={isSelected}
                        onChange={() => toggleOne(t.id)}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 sm:px-4 md:px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]">
                        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/*
                            In tabella mostriamo un titolo BREVE e leggibile
                            estratto dalla description "ricca" (C/O XXX -
                            CARTA → "XXX", bonifici → "Bonifico da XXX",
                            fallback al merchant / primo segmento utile).
                            Il testo COMPLETO è nel tooltip `title` ed è
                            sempre modificabile nella modale di edit.
                          */}
                          <p
                            className="text-[13.5px] sm:text-[14px] font-medium truncate"
                            title={t.description}
                          >
                            {shortenDescription(t.description, t.merchant)}
                          </p>
                          {t.is_subscription ? (
                            <span
                              title="Abbonamento ricorrente"
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color:var(--color-accent)]/12 px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--color-accent)]"
                            >
                              <Repeat className="h-2.5 w-2.5" strokeWidth={2.5} />
                              Ricorrente
                            </span>
                          ) : null}
                          {t.is_transfer ? (
                            <span
                              title="Giroconto interno — escluso da entrate/uscite"
                              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--color-muted-foreground)]"
                            >
                              <ArrowRightLeft className="h-2.5 w-2.5" strokeWidth={2.5} />
                              Giroconto
                            </span>
                          ) : null}
                        </div>

                        {t.tags && t.tags.length > 0 ? (
                          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                            {t.tags.map((tag, i) => (
                              <span key={`${tag}-${i}`}>
                                {i > 0 ? " " : null}
                                {onTagClick ? (
                                  <button
                                    type="button"
                                    title={`Filtra per ${tag}`}
                                    className="inline cursor-pointer border-0 bg-transparent p-0 align-baseline font-inherit text-inherit hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onTagClick(tag);
                                    }}
                                  >
                                    #{tag}
                                  </button>
                                ) : (
                                  <>{`#${tag}`}</>
                                )}
                              </span>
                            ))}
                          </p>
                        ) : null}

                        {/*
                          Mostriamo il `merchant` sotto SOLO se:
                           - è valorizzato e
                           - è diverso dal titolo breve (non ridondante) e
                           - non coincide con la description intera (perché
                             in quel caso sarebbe semplicemente una copia).
                          Così le transazioni Mediolanum con merchant
                          generico "Pagamenti paesi UE" non generano rumore.
                        */}
                        {(() => {
                          const short = shortenDescription(
                            t.description,
                            t.merchant
                          );
                          const m = (t.merchant ?? "").trim();
                          if (!m) return null;
                          if (m === short) return null;
                          if (m === t.description.trim()) return null;
                          const lowered = m.toLowerCase();
                          const shortLower = short.toLowerCase();
                          if (
                            lowered === shortLower ||
                            shortLower.includes(lowered) ||
                            lowered.includes(shortLower)
                          ) {
                            return null;
                          }
                          return (
                            <p
                              className="text-[11.5px] sm:text-[12px] text-[color:var(--color-muted-foreground)] truncate"
                              title={m}
                            >
                              {m}
                            </p>
                          );
                        })()}

                        {/*
                          Meta inline mostrati SOLO quando le colonne
                          dedicate sono nascoste dal CSS responsive:
                            - categoria+tag → visibili sotto md (tab/mobile)
                            - data          → visibile sotto sm (mobile)
                          Così le stesse informazioni restano sempre
                          consultabili senza costringere lo scroll.
                        */}
                        <div className="md:hidden mt-1.5 flex flex-wrap items-center gap-1.5">
                          {onCategoryClick ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCategoryClick(t.category);
                              }}
                              onKeyDown={(e) => e.stopPropagation()}
                              title={`Filtra per ${t.category}`}
                              className="inline-flex items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-2 py-0.5 text-[11px] font-medium text-[color:var(--color-foreground)] transition-colors hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)]"
                            >
                              {t.category}
                            </button>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-2 py-0.5 text-[11px] font-medium text-[color:var(--color-foreground)]">
                              {t.category}
                            </span>
                          )}
                          <span className="sm:hidden text-[10.5px] text-[color:var(--color-muted-foreground)]">
                            · {formatDate(t.date)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden md:table-cell px-3 sm:px-4 md:px-6 py-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {onCategoryClick ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onCategoryClick(t.category);
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          title={`Filtra per ${t.category}`}
                          className="inline-flex items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-foreground)] transition-colors hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
                        >
                          {t.category}
                        </button>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-2.5 py-1 text-[12px] font-medium text-[color:var(--color-foreground)]">
                          {t.category}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-3 sm:px-4 md:px-6 py-4 text-[13px] text-[color:var(--color-muted-foreground)] whitespace-nowrap">
                    {formatDate(t.date)}
                  </td>
                  <td
                    className={[
                      "px-3 sm:px-4 md:px-6 py-4 text-right text-[13.5px] sm:text-[14px] font-semibold whitespace-nowrap tabular-nums",
                      isIncome
                        ? "text-[color:var(--color-income)]"
                        : "text-[color:var(--color-foreground)]",
                    ].join(" ")}
                  >
                    {isIncome ? "+" : ""}
                    {formatCurrency(t.amount)}
                  </td>
                  {onRecategorize ? (
                    <td className="px-2 sm:px-3 md:px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isRecategorizing) return;
                          void onRecategorize(t);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        disabled={isRecategorizing}
                        title={
                          t.category === "Altro" && (t.tags?.length ?? 0) === 0
                            ? "Categorizza con IA"
                            : "Ricategorizza con IA"
                        }
                        aria-label="Ricategorizza con IA"
                        className={[
                          "inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] transition-colors",
                          isRecategorizing
                            ? "cursor-wait opacity-70"
                            : "hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)]",
                          // Evidenziamo la stellina per le righe "Altro" senza
                          // tag: quelle dove l'AI è (probabilmente) fallita o
                          // non è ancora stata eseguita.
                          t.category === "Altro" && (t.tags?.length ?? 0) === 0
                            ? "text-[color:var(--color-accent)]"
                            : "text-[color:var(--color-muted-foreground)]",
                        ].join(" ")}
                      >
                        {isRecategorizing ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            strokeWidth={2}
                          />
                        ) : (
                          <Sparkles className="h-4 w-4" strokeWidth={2} />
                        )}
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}

            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columnsCount}
                  className="px-4 sm:px-6 py-10 text-center text-[13px] text-[color:var(--color-muted-foreground)]"
                >
                  Nessuna transazione in questa pagina.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE_OPTIONS[0] ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPage(1);
            setPageSize(n);
          }}
        />
      ) : null}
    </section>
  );
}

function HeaderCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={label}
      aria-checked={indeterminate ? "mixed" : checked}
      role="checkbox"
      className={[
        "flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors",
        checked || indeterminate
          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
          : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-accent)]",
      ].join(" ")}
    >
      {checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : indeterminate ? (
        <span className="h-[2px] w-2 rounded-full bg-white" />
      ) : null}
    </button>
  );
}

function RowCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-label={checked ? "Deseleziona riga" : "Seleziona riga"}
      aria-checked={checked}
      role="checkbox"
      className={[
        "flex h-4 w-4 items-center justify-center rounded-[5px] border transition-colors",
        checked
          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white"
          : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-accent)]",
      ].join(" ")}
    >
      {checked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
    </button>
  );
}

function Pagination({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (n: number) => void;
  onPageSizeChange: (n: number) => void;
}) {
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--color-border)] px-4 sm:px-5 md:px-6 py-3 text-[12px] text-[color:var(--color-muted-foreground)]">
      <div className="flex items-center gap-2">
        <span>Righe per pagina</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-8 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 text-[12px] text-[color:var(--color-foreground)] outline-none transition-colors focus:border-[color:var(--color-accent)]"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          Pagina <strong className="text-[color:var(--color-foreground)]">{page}</strong> di{" "}
          <strong className="text-[color:var(--color-foreground)]">
            {totalPages}
          </strong>
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrev}
          aria-label="Pagina precedente"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          aria-label="Pagina successiva"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
