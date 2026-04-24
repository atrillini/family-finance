import {
  addDays,
  differenceInCalendarDays,
  format,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { it } from "date-fns/locale";
import type { Transaction } from "@/lib/mock-data";

/** Numero di settimane precedenti usate per la media mobile (burn rate). */
export const WEEKLY_BURN_DEFAULT_PREV_WEEKS = 8;

export type WeeklyBurnRow = {
  giorno: string;
  corrente: number;
  mediaPrecedenti: number;
};

function dayKeyFromTx(iso: string): string {
  return String(iso).slice(0, 10);
}

function expenseOnDay(txs: readonly Transaction[], day: Date): number {
  const key = format(day, "yyyy-MM-dd");
  let sum = 0;
  for (const t of txs) {
    if (t.is_transfer) continue;
    if (Number(t.amount) >= 0) continue;
    if (dayKeyFromTx(t.date) !== key) continue;
    sum += Math.abs(Number(t.amount));
  }
  return sum;
}

/** Spesa cumulativa dal lunedì `weekMonday` (inizio giornata) fino al giorno incluso `dayIndex` (0 = lun … 6 = dom). */
function cumulativeThroughDayIndex(
  txs: readonly Transaction[],
  weekMonday: Date,
  dayIndex: number
): number {
  let cum = 0;
  for (let i = 0; i <= dayIndex; i++) {
    cum += expenseOnDay(txs, addDays(weekMonday, i));
  }
  return cum;
}

/**
 * Confronto burn rate: cumulativo settimanale (ISO, lunedì–…) fino al giorno di
 * `referenceDay`, vs media degli stessi cumulativi nelle `numPrevWeeks` settimane
 * precedenti. Solo uscite (importo &lt; 0), giroconti esclusi.
 */
export function buildWeeklyBurnComparison(
  transactions: readonly Transaction[],
  referenceDay: Date,
  numPrevWeeks: number = WEEKLY_BURN_DEFAULT_PREV_WEEKS
): WeeklyBurnRow[] {
  const ref = startOfDay(referenceDay);
  const weekMonday = startOfWeek(ref, { weekStartsOn: 1 });
  const refIdx = Math.min(
    6,
    Math.max(0, differenceInCalendarDays(ref, weekMonday))
  );

  const prevWeeks: number[][] = [];
  for (let k = 1; k <= numPrevWeeks; k++) {
    const ws = addDays(weekMonday, -7 * k);
    const series: number[] = [];
    for (let i = 0; i <= refIdx; i++) {
      series.push(cumulativeThroughDayIndex(transactions, ws, i));
    }
    prevWeeks.push(series);
  }

  const rows: WeeklyBurnRow[] = [];
  for (let i = 0; i <= refIdx; i++) {
    const corrente = cumulativeThroughDayIndex(transactions, weekMonday, i);
    let sum = 0;
    let n = 0;
    for (const w of prevWeeks) {
      const v = w[i];
      if (v !== undefined) {
        sum += v;
        n += 1;
      }
    }
    const mediaPrecedenti = n > 0 ? sum / n : 0;
    const dayDate = addDays(weekMonday, i);
    rows.push({
      giorno: format(dayDate, "EEE d MMM", { locale: it }),
      corrente,
      mediaPrecedenti,
    });
  }

  return rows;
}

/** Primo giorno da cui servono transazioni per coprire tutte le settimane di confronto. */
export function weeklyBurnDataStart(
  referenceDay: Date,
  numPrevWeeks: number = WEEKLY_BURN_DEFAULT_PREV_WEEKS
): Date {
  const ref = startOfDay(referenceDay);
  const weekMonday = startOfWeek(ref, { weekStartsOn: 1 });
  return startOfDay(addDays(weekMonday, -7 * numPrevWeeks));
}

/** Etichetta leggibile per la settimana ISO (lun–dom) che contiene `referenceDay`. */
export function formatWeekRangeLabel(referenceDay: Date): string {
  const ref = startOfDay(referenceDay);
  const start = startOfWeek(ref, { weekStartsOn: 1 });
  const end = addDays(start, 6);
  if (start.getFullYear() === end.getFullYear()) {
    return `${format(start, "d MMM", { locale: it })} – ${format(end, "d MMM yyyy", { locale: it })}`;
  }
  return `${format(start, "d MMM yyyy", { locale: it })} – ${format(end, "d MMM yyyy", { locale: it })}`;
}
