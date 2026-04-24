import {
  eachDayOfInterval,
  format,
  startOfDay,
} from "date-fns";
import { it } from "date-fns/locale";
import {
  isDateInRange,
  type DateRange,
} from "@/lib/date-range";
import type { Transaction } from "@/lib/mock-data";

export type CumulativeExpenseRow = {
  /** Etichetta asse X (giorno nel periodo corrente). */
  giorno: string;
  /** Spesa cumulativa (valori assoluti) nel periodo selezionato. */
  corrente: number;
  /** Spesa cumulativa nel periodo precedente (stesso numero di giorni allineati). */
  precedente: number;
};

function dayKeyFromTx(iso: string): string {
  return String(iso).slice(0, 10);
}

function dailyExpenseAbs(
  txs: readonly Transaction[],
  day: Date
): number {
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

/**
 * Serie giornaliere di spesa cumulativa: periodo selezionato vs periodo precedente
 * (stessa lunghezza in giorni). Solo uscite reali (importo &lt; 0), giroconti esclusi.
 */
export function buildCumulativeExpenseComparison(
  transactions: readonly Transaction[],
  currentRange: DateRange,
  previousRange: DateRange
): CumulativeExpenseRow[] {
  const curStart = startOfDay(currentRange.from);
  const curEnd = startOfDay(currentRange.to ?? currentRange.from);
  const curDays = eachDayOfInterval({ start: curStart, end: curEnd });

  const prevStart = startOfDay(previousRange.from);
  const prevEnd = startOfDay(previousRange.to ?? previousRange.from);
  const prevDays = eachDayOfInterval({ start: prevStart, end: prevEnd });

  const n = Math.min(curDays.length, prevDays.length);
  const rows: CumulativeExpenseRow[] = [];
  let cumCur = 0;
  let cumPrev = 0;

  for (let i = 0; i < n; i++) {
    cumCur += dailyExpenseAbs(transactions, curDays[i]!);
    cumPrev += dailyExpenseAbs(transactions, prevDays[i]!);
    rows.push({
      giorno: format(curDays[i]!, "d MMM", { locale: it }),
      corrente: cumCur,
      precedente: cumPrev,
    });
  }

  return rows;
}

/** Uscite totali (absolute) nel range, esclusi giroconti. */
export function totalExpenseInRange(
  transactions: readonly Transaction[],
  range: DateRange
): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.is_transfer) continue;
    if (Number(t.amount) >= 0) continue;
    if (!isDateInRange(t.date, range)) continue;
    sum += Math.abs(Number(t.amount));
  }
  return sum;
}
