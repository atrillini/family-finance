import { endOfDay, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import { it } from "date-fns/locale";
import {
  buildPresets,
  formatRangeLabel,
  rangesEqual,
  type DateRange,
} from "./date-range";

export type PeriodLabelParts = {
  /** Titolo principale (es. "Aprile 2026", "Ultimi 7 giorni"). */
  primary: string;
  /** Sottotesto con l’intervallo esplicito (es. "15–21 apr 2026"). */
  secondary?: string;
};

/**
 * Etichetta leggibile per le card riassuntive (home) in base al periodo attivo.
 * Se il range coincide con un preset ("Ultimi 7 giorni", …) mostra nome preset
 * + range; se è il mese corrente (preset "Questo mese") il titolo è il mese
 * per esteso con sottotitolo sul range.
 */
export function formatPeriodHeading(
  range: DateRange | null,
  now: Date = new Date()
): PeriodLabelParts {
  if (!range) {
    return { primary: "Tutti i periodi" };
  }

  const presets = buildPresets(now);
  const presetHit = presets.find((p) => rangesEqual(p.range(), range));
  const rangePretty = formatRangeLabel(range);

  if (presetHit) {
    if (presetHit.id === "this-month") {
      const title = format(range.from, "LLLL yyyy", { locale: it });
      const cap = title.charAt(0).toUpperCase() + title.slice(1);
      return { primary: cap, secondary: rangePretty };
    }
    return { primary: presetHit.label, secondary: rangePretty };
  }

  const from = startOfDay(range.from);
  const to = endOfDay(range.to ?? range.from);

  const isFullMonth =
    from.getTime() === startOfMonth(from).getTime() &&
    to.getTime() === endOfMonth(from).getTime() &&
    from.getMonth() === to.getMonth() &&
    from.getFullYear() === to.getFullYear();

  if (isFullMonth) {
    const title = format(from, "LLLL yyyy", { locale: it });
    return {
      primary: title.charAt(0).toUpperCase() + title.slice(1),
    };
  }

  return { primary: rangePretty };
}
