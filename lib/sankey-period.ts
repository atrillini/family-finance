import { isDateInRange, type DateRange } from "@/lib/date-range";
import type { Transaction } from "@/lib/mock-data";

const MAX_NODES_PER_SIDE = 10;

/** Nodo centrale del Sankey (stesso testo in UI e in `findIndex`). */
export const PERIOD_SANKEY_CENTER_LABEL = "Flusso nel periodo";
const CENTER = PERIOD_SANKEY_CENTER_LABEL;
const SYNTH_COVER = "Copertura oltre le entrate";
const SYNTH_SURPLUS = "Avanzo non speso";
const NO_INCOME = "Entrate non registrate";
const NO_EXPENSE = "Uscite non registrate";

export type PeriodSankeyRow = { name: string; value: number };

export type PeriodSankeyData = {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
};

function mergeTail(
  map: Map<string, number>,
  max: number,
  otherLabel: string
): PeriodSankeyRow[] {
  const entries = [...map.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return [];
  if (entries.length <= max) {
    return entries.map(([name, value]) => ({ name, value }));
  }
  const top = entries.slice(0, max - 1);
  const rest = entries.slice(max - 1).reduce((s, [, v]) => s + v, 0);
  return [
    ...top.map(([name, value]) => ({ name, value })),
    { name: otherLabel, value: rest },
  ];
}

function sumRows(rows: PeriodSankeyRow[]): number {
  return rows.reduce((s, r) => s + r.value, 0);
}

/**
 * Sankey entrate → nodo centrale → uscite per categoria nel periodo.
 * Giroconti esclusi. Se entrate ≠ uscite, nodi sintetici bilanciano il flusso
 * (copertura o avanzo), così il layout Sankey resta valido.
 */
export function buildPeriodSankeyData(
  transactions: readonly Transaction[],
  range: DateRange
): PeriodSankeyData | null {
  const incomeMap = new Map<string, number>();
  const expenseMap = new Map<string, number>();

  for (const t of transactions) {
    if (t.is_transfer) continue;
    if (!isDateInRange(t.date, range)) continue;
    const amt = Number(t.amount);
    const cat = (t.category || "Altro").trim() || "Altro";
    if (amt > 0) {
      incomeMap.set(cat, (incomeMap.get(cat) ?? 0) + amt);
    } else if (amt < 0) {
      expenseMap.set(cat, (expenseMap.get(cat) ?? 0) + Math.abs(amt));
    }
  }

  let left = mergeTail(incomeMap, MAX_NODES_PER_SIDE, "Altre entrate");
  let right = mergeTail(expenseMap, MAX_NODES_PER_SIDE, "Altre uscite");

  let totalInc = sumRows(left);
  let totalExp = sumRows(right);

  if (totalInc === 0 && totalExp === 0) return null;

  if (totalInc === 0 && totalExp > 0) {
    left = [{ name: NO_INCOME, value: totalExp }];
    totalInc = totalExp;
  }
  if (totalExp === 0 && totalInc > 0) {
    right = [{ name: NO_EXPENSE, value: totalInc }];
    totalExp = totalInc;
  }

  if (totalInc < totalExp) {
    left = [...left, { name: SYNTH_COVER, value: totalExp - totalInc }];
    totalInc = totalExp;
  } else if (totalInc > totalExp) {
    right = [...right, { name: SYNTH_SURPLUS, value: totalInc - totalExp }];
    totalExp = totalInc;
  }

  const nodes: { name: string }[] = [
    ...left.map(({ name }) => ({ name })),
    { name: CENTER },
    ...right.map(({ name }) => ({ name })),
  ];

  const centerIdx = left.length;
  const links: { source: number; target: number; value: number }[] = [];

  for (let i = 0; i < left.length; i++) {
    links.push({ source: i, target: centerIdx, value: left[i]!.value });
  }
  for (let j = 0; j < right.length; j++) {
    const targetIdx = centerIdx + 1 + j;
    links.push({ source: centerIdx, target: targetIdx, value: right[j]!.value });
  }

  return { nodes, links };
}
