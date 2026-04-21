"use client";

import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker, type DateRange as RDPDateRange } from "react-day-picker";
import { it } from "date-fns/locale";
import { Calendar as CalendarIcon, X } from "lucide-react";
import {
  buildPresets,
  formatRangeLabel,
  rangesEqual,
  type DateRange,
} from "@/lib/date-range";

import "react-day-picker/style.css";
import "./date-range-picker.css";

type Props = {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  /** Classe extra applicata al pulsante trigger, per adattarlo al layout. */
  className?: string;
};

/**
 * Pulsante compatto che apre un popover con:
 *   - una colonna di preset rapidi (Oggi, Ultimi 7 giorni, ecc.)
 *   - un calendario in modalità `range` (react-day-picker v9)
 *   - un footer con "Azzera" e "Applica"
 *
 * Il popover è ancorato al trigger e si chiude automaticamente alla
 * pressione di Esc o al click fuori (gestione di Radix). Lo stato interno
 * `draft` contiene la selezione in corso e viene confermata solo al click
 * di "Applica" o di un preset, così l'utente può annullare senza effetti.
 */
export default function DateRangePicker({
  value,
  onChange,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | null>(value);

  // Rigeneriamo i preset ad ogni apertura così "Oggi" riflette la data
  // corrente anche se il tab è rimasto aperto a cavallo di mezzanotte.
  const presets = useMemo(() => buildPresets(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = formatRangeLabel(value);
  const activePresetId = useMemo(() => {
    if (!value) return null;
    const found = presets.find((p) => rangesEqual(p.range(), value));
    return found?.id ?? null;
  }, [presets, value]);

  function openAndSync(next: boolean) {
    setOpen(next);
    if (next) setDraft(value);
  }

  function applyPreset(id: string) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    const next = preset.range();
    setDraft(next);
    onChange(next);
    setOpen(false);
  }

  function applyDraft() {
    onChange(draft);
    setOpen(false);
  }

  function clear() {
    setDraft(null);
    onChange(null);
    setOpen(false);
  }

  // react-day-picker usa `{ from, to }` con campi potenzialmente undefined
  // in selezione "range". Convertiamo nel nostro `DateRange` solo se c'è
  // almeno `from`: prima di quel momento il draft resta al valore corrente.
  function handleSelect(next: RDPDateRange | undefined) {
    if (!next || !next.from) {
      setDraft(null);
      return;
    }
    setDraft({ from: next.from, to: next.to });
  }

  return (
    <Popover.Root open={open} onOpenChange={openAndSync}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Seleziona un intervallo di date"
          className={[
            "inline-flex items-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-10 text-[13px] font-medium transition-colors hover:bg-[color:var(--color-surface-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40",
            value ? "text-[color:var(--color-foreground)]" : "text-[color:var(--color-muted-foreground)]",
            className ?? "",
          ].join(" ")}
        >
          <CalendarIcon className="h-4 w-4 text-[color:var(--color-accent)]" />
          <span className="truncate max-w-[180px]">{label}</span>
          {value ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                clear();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  clear();
                }
              }}
              aria-label="Azzera intervallo"
              className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
            >
              <X className="h-3 w-3" />
            </span>
          ) : null}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 overflow-hidden rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex flex-col md:flex-row">
            {/* Sidebar preset */}
            <div className="flex w-full shrink-0 flex-col gap-0.5 border-b border-[color:var(--color-border)] p-2 md:w-44 md:border-b-0 md:border-r">
              <p className="px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                Periodi rapidi
              </p>
              {presets.map((p) => {
                const active = activePresetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyPreset(p.id)}
                    className={[
                      "rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors",
                      active
                        ? "bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)] font-medium"
                        : "text-[color:var(--color-foreground)] hover:bg-[color:var(--color-surface-muted)]",
                    ].join(" ")}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Calendario */}
            <div className="p-3">
              <DayPicker
                mode="range"
                locale={it}
                weekStartsOn={1}
                numberOfMonths={1}
                defaultMonth={draft?.from ?? value?.from ?? new Date()}
                selected={
                  draft
                    ? { from: draft.from, to: draft.to }
                    : undefined
                }
                onSelect={handleSelect}
                className="rdp-themed"
              />

              <div className="mt-2 flex items-center justify-between gap-2 border-t border-[color:var(--color-border)] pt-3">
                <button
                  type="button"
                  onClick={clear}
                  className="text-[12px] font-medium text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                >
                  Azzera
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-8 text-[12px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={applyDraft}
                    disabled={!draft}
                    className="inline-flex items-center rounded-xl bg-[color:var(--color-foreground)] px-3 h-8 text-[12px] font-semibold text-[color:var(--color-background)] transition-opacity disabled:opacity-50"
                  >
                    Applica
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
