import type { Transaction } from "@/lib/mock-data";
import { isTransactionVisible } from "@/lib/transaction-visibility";
import { normalizeTagLabel } from "@/lib/tag-colors";
import { isDateInRange, type DateRange } from "@/lib/date-range";

export type TaggedFlowTotals = {
  income: number;
  expense: number;
};

export type DeltaPctResult =
  | { kind: "na" }
  | { kind: "new" }
  | { kind: "pct"; value: number };

/**
 * Aggrega entrate/uscite sul sottoinsieme di tag selezionato: stessa logica del
 * Sankey per-tag (quota uguale se la transazione ha più tag nell'insieme S).
 * Giroconti esclusi; transazioni soft-delete escluse.
 */
export function summarizeTaggedFlows(
  transactions: readonly Transaction[],
  range: DateRange,
  selectedTags: readonly string[]
): TaggedFlowTotals {
  const pinned = [
    ...new Set(selectedTags.map((t) => normalizeTagLabel(t)).filter(Boolean)),
  ];
  if (pinned.length === 0) return { income: 0, expense: 0 };
  const pinnedSet = new Set(pinned);

  let income = 0;
  let expense = 0;

  for (const t of transactions) {
    if (t.is_transfer) continue;
    if (!isTransactionVisible(t)) continue;
    if (!isDateInRange(t.date, range)) continue;

    const amt = Number(t.amount);
    const txTags = (t.tags ?? [])
      .map((x) => normalizeTagLabel(String(x)))
      .filter(Boolean);
    const matched = [...new Set(txTags.filter((x) => pinnedSet.has(x)))];
    if (matched.length === 0) continue;

    const share = matched.length;

    if (amt > 0) {
      income += amt / share;
    } else if (amt < 0) {
      expense += Math.abs(amt) / share;
    }
  }

  return { income, expense };
}

/** Variazione % da periodo di riferimento al periodo di confronto: (cmp − ref) / ref. */
export function deltaPctRefToCmp(ref: number, cmp: number): DeltaPctResult {
  if (!Number.isFinite(ref) || !Number.isFinite(cmp)) return { kind: "na" };
  if (ref === 0 && cmp === 0) return { kind: "na" };
  if (ref === 0) return { kind: "new" };
  return { kind: "pct", value: ((cmp - ref) / ref) * 100 };
}

export function formatDeltaPctIt(d: DeltaPctResult): string {
  if (d.kind === "na") return "—";
  if (d.kind === "new") return "Nuovo";
  const v = d.value;
  const body = `${Math.abs(v).toFixed(1).replace(".", ",")} %`;
  if (v > 0) return `+${body}`;
  if (v < 0) return `-${body}`;
  return `0,0 %`;
}
