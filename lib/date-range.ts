import {
  addDays,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { it } from "date-fns/locale";

/**
 * Range temporale selezionato dall'utente. `to` è opzionale perché durante
 * la selezione nel calendario l'utente clicca prima il giorno di inizio e
 * solo dopo il giorno di fine (selezione a due step). Quando `to` è
 * assente, il filtro va interpretato come "giorno singolo".
 */
export type DateRange = {
  from: Date;
  to?: Date;
};

export type DatePreset = {
  id: string;
  label: string;
  range: () => DateRange;
};

/**
 * Preset rapidi mostrati nella sidebar del popover. Tutti i range sono
 * "inclusivi" sia sul giorno di inizio che sul giorno di fine: chi consuma
 * il range è responsabile di normalizzare (startOfDay/endOfDay) prima di
 * inviare a Supabase.
 */
export function buildPresets(now: Date = new Date()): DatePreset[] {
  const today = startOfDay(now);
  return [
    {
      id: "today",
      label: "Oggi",
      range: () => ({ from: today, to: today }),
    },
    {
      id: "last-7",
      label: "Ultimi 7 giorni",
      range: () => ({ from: addDays(today, -6), to: today }),
    },
    {
      id: "this-month",
      label: "Questo mese",
      range: () => ({ from: startOfMonth(today), to: today }),
    },
    {
      id: "last-month",
      label: "Mese scorso",
      range: () => {
        const lastMonth = subMonths(today, 1);
        return {
          from: startOfMonth(lastMonth),
          to: endOfMonth(lastMonth),
        };
      },
    },
    {
      id: "last-3-months",
      label: "Ultimi 3 mesi",
      range: () => ({ from: startOfMonth(subMonths(today, 2)), to: today }),
    },
    {
      id: "this-year",
      label: "Anno in corso",
      range: () => ({
        from: new Date(today.getFullYear(), 0, 1),
        to: today,
      }),
    },
  ];
}

/**
 * Restituisce la coppia di ISO-string (inizio-giornata / fine-giornata)
 * adatta a filtrare una colonna `timestamptz` su Supabase. Se `to` è
 * assente viene interpretato come "solo quel giorno".
 */
export function rangeToIsoBounds(range: DateRange): {
  fromIso: string;
  toIso: string;
} {
  const from = startOfDay(range.from);
  const to = endOfDay(range.to ?? range.from);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

/**
 * Verifica se una transazione (o un record con campo `date` ISO) ricade
 * nel range. Usata per il filtraggio lato client sui mock.
 */
export function isDateInRange(
  dateIso: string | Date,
  range: DateRange
): boolean {
  const d = typeof dateIso === "string" ? new Date(dateIso) : dateIso;
  if (Number.isNaN(d.getTime())) return false;
  const from = startOfDay(range.from).getTime();
  const to = endOfDay(range.to ?? range.from).getTime();
  const t = d.getTime();
  return t >= from && t <= to;
}

/**
 * Etichetta leggibile per il pulsante del picker. Esempi:
 *   - "15 apr 2026"             (data singola)
 *   - "1 – 30 apr 2026"         (stesso mese, stesso anno)
 *   - "15 mar – 2 apr 2026"     (mesi diversi, stesso anno)
 *   - "15 dic 2025 – 2 gen 2026" (anni diversi)
 */
export function formatRangeLabel(range: DateRange | null): string {
  if (!range) return "Tutti i periodi";
  const { from, to } = range;
  if (!to || sameDay(from, to)) {
    return format(from, "d MMM yyyy", { locale: it });
  }
  if (from.getFullYear() === to.getFullYear()) {
    if (from.getMonth() === to.getMonth()) {
      return `${format(from, "d", { locale: it })} – ${format(to, "d MMM yyyy", {
        locale: it,
      })}`;
    }
    return `${format(from, "d MMM", { locale: it })} – ${format(
      to,
      "d MMM yyyy",
      { locale: it }
    )}`;
  }
  return `${format(from, "d MMM yyyy", { locale: it })} – ${format(
    to,
    "d MMM yyyy",
    { locale: it }
  )}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Restituisce il periodo immediatamente precedente a quello dato, con la
 * stessa durata. Serve per calcolare la variazione % "questo periodo vs
 * periodo precedente" delle card riassuntive.
 *
 * Esempi:
 *   - range = 1-30 apr 2026 → 2-31 mar 2026 (30 giorni indietro)
 *   - range = "oggi"         → "ieri"
 *
 * Se `range` è null (= "tutti i periodi"), il calcolo non è significativo
 * e ritorniamo null: il chiamante nasconderà il delta.
 */
export function getPreviousRange(range: DateRange | null): DateRange | null {
  if (!range) return null;
  const from = startOfDay(range.from);
  const to = startOfDay(range.to ?? range.from);
  const durationMs = to.getTime() - from.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.max(1, Math.round(durationMs / dayMs) + 1);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from: prevFrom, to: prevTo };
}

/**
 * Verifica se due range coincidono (utile per evidenziare il preset attivo
 * nel popover).
 */
export function rangesEqual(
  a: DateRange | null,
  b: DateRange | null
): boolean {
  if (!a || !b) return a === b;
  if (!sameDay(a.from, b.from)) return false;
  const aTo = a.to ?? a.from;
  const bTo = b.to ?? b.from;
  return sameDay(aTo, bTo);
}
