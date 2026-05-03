import {
  addDays,
  endOfDay,
  endOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  startOfDay,
  startOfISOWeek,
} from "date-fns";
import type { DateRange } from "@/lib/date-range";

/**
 * Range calendario ISO 8601 (lun–dom) per anno di numerazione settimanale e
 * numero settimana (1–53). Ritorna `null` se la coppia non esiste.
 */
export function isoWeekYearNumberToRange(
  weekYear: number,
  isoWeek: number
): DateRange | null {
  if (!Number.isFinite(weekYear) || isoWeek < 1 || isoWeek > 53) return null;

  const scanEnd = new Date(weekYear + 1, 11, 31);
  let cursor = new Date(weekYear, 0, 1);

  while (cursor <= scanEnd) {
    if (getISOWeekYear(cursor) === weekYear && getISOWeek(cursor) === isoWeek) {
      const from = startOfDay(startOfISOWeek(cursor));
      const to = endOfDay(endOfISOWeek(cursor));
      return { from, to };
    }
    cursor = addDays(cursor, 1);
  }

  return null;
}
