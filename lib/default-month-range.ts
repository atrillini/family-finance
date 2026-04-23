import { parseISO, startOfDay, startOfMonth } from "date-fns";
import { rangeToIsoBounds, type DateRange } from "./date-range";

/** Mese solare corrente: dal primo del mese a oggi (inizio/fine giornata normalizzati). */
export function getDefaultMonthRangeIso(): { fromIso: string; toIso: string } {
  const today = startOfDay(new Date());
  return rangeToIsoBounds({ from: startOfMonth(today), to: today });
}

export function dateRangeFromIso(iso: {
  fromIso: string;
  toIso: string;
}): DateRange {
  return { from: parseISO(iso.fromIso), to: parseISO(iso.toIso) };
}
