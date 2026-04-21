"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
} from "lucide-react";
import {
  addMonths,
  endOfMonth,
  isAfter,
  isBefore,
  startOfDay,
  startOfMonth,
} from "date-fns";
import type { DateRange } from "@/lib/date-range";
import { rangesEqual } from "@/lib/date-range";

/**
 * Nomi dei mesi in italiano (abbreviati e per esteso). Li teniamo costanti
 * invece di passare per `Intl.DateTimeFormat` per evitare gli stessi rischi
 * di hydration mismatch già affrontati in `formatDate` / `formatCurrency`:
 * server con ICU "small" e client con ICU completa possono produrre stringhe
 * leggermente diverse (es. "apr" vs "apr.").
 */
const MONTHS_LONG = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
] as const;

type Props = {
  value: DateRange | null;
  onChange: (range: DateRange) => void;
  /**
   * Primo mese selezionabile. Di default = gennaio dell'anno del floor
   * (`NEXT_PUBLIC_SYNC_MIN_DATE` o `2026-01-01`). Serve a non proporre
   * mesi per cui non abbiamo neanche transazioni in DB.
   */
  minDate?: Date;
  /**
   * Ultimo mese selezionabile. Di default = oggi. Impedisce di navigare
   * in un futuro per cui non ci sono ancora dati.
   */
  maxDate?: Date;
  className?: string;
};

function getDefaultMinDate(): Date {
  const envRaw =
    process.env.NEXT_PUBLIC_SYNC_MIN_DATE &&
    /^\d{4}-\d{2}-\d{2}$/.test(process.env.NEXT_PUBLIC_SYNC_MIN_DATE)
      ? process.env.NEXT_PUBLIC_SYNC_MIN_DATE
      : "2026-01-01";
  // Parsing locale (non UTC): il calendario lavora in fuso locale, e
  // confrontare `startOfMonth(new Date("2026-01-01"))` con un Date locale
  // potrebbe generare off-by-one in zone orarie negative.
  const [y, m, d] = envRaw.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Costruisce il range "mese intero" da una qualsiasi data, clampando il
 * `to` alla data massima consentita (tipicamente oggi).
 *
 * Esempi, ipotizzando oggi = 20 apr 2026:
 *   - anchor = 15 mar 2026 → { 1 mar 2026, 31 mar 2026 }
 *   - anchor = 10 apr 2026 → { 1 apr 2026, 20 apr 2026 }   ← clamp!
 *   - anchor =  3 mag 2026 → illegale (> maxDate)
 */
function wholeMonthRange(anchor: Date, maxDate: Date): DateRange {
  const from = startOfMonth(anchor);
  const end = endOfMonth(anchor);
  const capped = startOfDay(maxDate);
  const to = isAfter(end, capped) ? capped : end;
  return { from, to };
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/**
 * Navigator "mese per mese": frecce sinistra/destra, label cliccabile che
 * apre un popover con tutti i mesi dell'anno (e controlli anno in alto),
 * e pulsante "Oggi" per tornare al mese corrente.
 *
 * Funziona in coordinamento con `DateRangePicker`:
 *   - se l'utente sceglie un mese qui, `onChange` imposta un range "intero"
 *     di quel mese (capped ad oggi per il mese corrente);
 *   - se invece il `value` attivo è un range arbitrario (p.es. "ultimi 7
 *     giorni") qui mostriamo comunque il mese di `value.from` come "mese
 *     visualizzato", ma le frecce riporteranno a un mese pieno (questo è
 *     intenzionale: l'utente sta dichiarando di voler passare alla
 *     navigazione mensile).
 */
export default function MonthNavigator({
  value,
  onChange,
  minDate,
  maxDate,
  className,
}: Props) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const effectiveMax = maxDate ?? today;
  const effectiveMin = minDate ?? getDefaultMinDate();

  // "Mese attualmente visualizzato": dedotto dal value se presente,
  // altrimenti è il mese corrente (puro display, non ancora applicato).
  const activeAnchor = value?.from ?? today;

  // Il range attivo è "un mese intero" se coincide con whole-month di quel
  // mese (dopo clamp a effectiveMax). In caso contrario il badge "Oggi"
  // resta proposto ma il label deve comunque valorizzare il mese.
  const activeMonthRange = wholeMonthRange(activeAnchor, effectiveMax);
  const activeIsWholeMonth = value ? rangesEqual(value, activeMonthRange) : false;

  const canGoPrev = useMemo(() => {
    const prev = startOfMonth(addMonths(activeAnchor, -1));
    return !isBefore(prev, startOfMonth(effectiveMin));
  }, [activeAnchor, effectiveMin]);

  const canGoNext = useMemo(() => {
    const next = startOfMonth(addMonths(activeAnchor, 1));
    return !isAfter(next, startOfMonth(effectiveMax));
  }, [activeAnchor, effectiveMax]);

  function goToMonth(anchor: Date) {
    const clamped = isBefore(anchor, effectiveMin)
      ? effectiveMin
      : isAfter(anchor, effectiveMax)
      ? effectiveMax
      : anchor;
    onChange(wholeMonthRange(clamped, effectiveMax));
  }

  function shift(delta: number) {
    goToMonth(addMonths(activeAnchor, delta));
  }

  function goToday() {
    goToMonth(today);
  }

  const label = `${MONTHS_LONG[activeAnchor.getMonth()]} ${activeAnchor.getFullYear()}`;
  const isCurrentMonth = sameMonth(activeAnchor, today) && activeIsWholeMonth;

  return (
    <div
      className={[
        "inline-flex items-center gap-1 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-0.5",
        className ?? "",
      ].join(" ")}
    >
      <button
        type="button"
        aria-label="Mese precedente"
        disabled={!canGoPrev}
        onClick={() => shift(-1)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <MonthPicker
        anchor={activeAnchor}
        minDate={effectiveMin}
        maxDate={effectiveMax}
        onPick={goToMonth}
      >
        <button
          type="button"
          aria-label="Seleziona mese"
          className={[
            "min-w-[8.5rem] rounded-lg px-3 h-9 text-[13px] font-medium transition-colors",
            activeIsWholeMonth
              ? "text-[color:var(--color-foreground)] hover:bg-[color:var(--color-surface-muted)]"
              : "text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]",
          ].join(" ")}
        >
          {label}
        </button>
      </MonthPicker>

      <button
        type="button"
        aria-label="Mese successivo"
        disabled={!canGoNext}
        onClick={() => shift(1)}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* "Oggi" torna al mese corrente; appare in rilievo quando NON sei
          già sul mese corrente, e sbiadito (ma cliccabile) quando lo sei. */}
      <button
        type="button"
        onClick={goToday}
        title="Vai al mese corrente"
        className={[
          "ml-0.5 inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
          isCurrentMonth
            ? "text-[color:var(--color-muted-foreground)]"
            : "text-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10",
        ].join(" ")}
      >
        <CircleDot className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Oggi</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popover di selezione mese: anno con frecce + griglia 3×4 mesi.
// ---------------------------------------------------------------------------

function MonthPicker({
  anchor,
  minDate,
  maxDate,
  onPick,
  children,
}: {
  anchor: Date;
  minDate: Date;
  maxDate: Date;
  onPick: (d: Date) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState<number>(anchor.getFullYear());

  // Riallineamento quando cambia l'ancora esterna (es. dopo una freccia).
  // Non usiamo useEffect perché basta un derive al momento dell'apertura.
  function handleOpen(next: boolean) {
    setOpen(next);
    if (next) setViewYear(anchor.getFullYear());
  }

  const minYear = minDate.getFullYear();
  const maxYear = maxDate.getFullYear();
  const prevYearOk = viewYear > minYear;
  const nextYearOk = viewYear < maxYear;

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={8}
          className="z-50 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              aria-label="Anno precedente"
              disabled={!prevYearOk}
              onClick={() => setViewYear((y) => y - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-[13px] font-semibold tabular-nums">
              {viewYear}
            </div>
            <button
              type="button"
              aria-label="Anno successivo"
              disabled={!nextYearOk}
              onClick={() => setViewYear((y) => y + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)] disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {MONTHS_LONG.map((name, m) => {
              const cell = new Date(viewYear, m, 1);
              const tooEarly = isBefore(cell, startOfMonth(minDate));
              const tooLate = isAfter(cell, startOfMonth(maxDate));
              const disabled = tooEarly || tooLate;
              const isAnchor =
                anchor.getFullYear() === viewYear && anchor.getMonth() === m;
              return (
                <button
                  key={name}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onPick(cell);
                    setOpen(false);
                  }}
                  className={[
                    "h-9 rounded-lg px-2 text-[12.5px] font-medium transition-colors",
                    isAnchor
                      ? "bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)]"
                      : "text-[color:var(--color-foreground)] hover:bg-[color:var(--color-surface-muted)]",
                    disabled
                      ? "cursor-not-allowed opacity-30 hover:bg-transparent"
                      : "",
                  ].join(" ")}
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
