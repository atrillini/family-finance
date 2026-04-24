import type { ChartInsightPayload } from "@/lib/gemini";

/** Insight deterministico quando Gemini non è disponibile o fallisce. */
export function fallbackInsightFromAggregates(p: ChartInsightPayload): string {
  const parts: string[] = [];
  if (p.expenseDeltaPct != null) {
    if (p.expenseDeltaPct > 5) {
      parts.push(
        `Nel periodo **${p.periodCurrentLabel}** le uscite sono circa **+${p.expenseDeltaPct.toFixed(0)}%** rispetto a **${p.periodPreviousLabel}**.`
      );
    } else if (p.expenseDeltaPct < -5) {
      parts.push(
        `Nel periodo **${p.periodCurrentLabel}** le uscite sono circa **${p.expenseDeltaPct.toFixed(0)}%** rispetto a **${p.periodPreviousLabel}** (in calo).`
      );
    } else {
      parts.push(
        `Le uscite restano **in linea** con il periodo precedente (variazione ~${p.expenseDeltaPct > 0 ? "+" : ""}${p.expenseDeltaPct.toFixed(0)}%).`
      );
    }
  } else {
    parts.push(
      `Uscite **${p.expenseCurrent.toFixed(2)} €** nel periodo **${p.periodCurrentLabel}**.`
    );
  }
  const top = p.topTagsCurrent[0];
  if (top && top.amount > 0) {
    parts.push(
      ` Tag principale: **${top.tag}** (~${top.sharePct.toFixed(0)}% delle uscite).`
    );
  }
  if (p.weeklyBurn) {
    const diff =
      p.weeklyBurn.spendCumulativeEnd - p.weeklyBurn.avgPreviousWeeksCumulativeEnd;
    const sign = diff > 0 ? "sopra" : diff < 0 ? "sotto" : "in linea con";
    parts.push(
      ` Nella settimana **${p.weeklyBurn.weekLabel}** il cumulativo è **${sign}** la media delle settimane precedenti allo stesso giorno.`
    );
  }
  return parts.join("");
}
