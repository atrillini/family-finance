import { isDateInRange, type DateRange } from "@/lib/date-range";
import type { Transaction } from "@/lib/mock-data";
import { normalizeTagLabel } from "@/lib/tag-colors";

const MAX_NODES_PER_SIDE = 10;

/** Nodo centrale del Sankey (stesso testo in UI e in `findIndex`). */
export const PERIOD_SANKEY_CENTER_LABEL = "Flusso nel periodo";
const CENTER = PERIOD_SANKEY_CENTER_LABEL;
const SYNTH_COVER = "Copertura oltre le entrate";
const SYNTH_SURPLUS = "Avanzo non speso";
const NO_INCOME = "Entrate non registrate";
const NO_EXPENSE = "Uscite non registrate";

/** Transazioni senza nessuno dei tag scelti (lato entrate / uscite). */
const TAG_GAP_INCOME = "Fuori dai tag scelti (entrate)";
const TAG_GAP_EXPENSE = "Fuori dai tag scelti (uscite)";

export type PeriodSankeyRow = { name: string; value: number };

export type PeriodSankeyLinkTransaction = {
  id: string;
  date: string;
  description: string;
  merchant: string | null;
  amount: number;
};

export type PeriodSankeyLink = {
  source: number;
  target: number;
  value: number;
  transactions?: PeriodSankeyLinkTransaction[];
};

export type PeriodSankeyData = {
  nodes: { name: string }[];
  links: PeriodSankeyLink[];
};

export type SankeyGroupMode = "category" | "tags";

function sumRows(rows: PeriodSankeyRow[]): number {
  return rows.reduce((s, r) => s + r.value, 0);
}

function pushTxContribution(
  map: Map<string, PeriodSankeyLinkTransaction[]>,
  key: string,
  tx: PeriodSankeyLinkTransaction
) {
  const arr = map.get(key);
  if (arr) arr.push(tx);
  else map.set(key, [tx]);
}

function mergeTailWithBuckets(
  map: Map<string, number>,
  max: number,
  otherLabel: string
): { rows: PeriodSankeyRow[]; buckets: Map<string, string[]> } {
  const entries = [...map.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const buckets = new Map<string, string[]>();
  if (entries.length === 0) return { rows: [], buckets };
  if (entries.length <= max) {
    const rows = entries.map(([name, value]) => ({ name, value }));
    for (const [name] of entries) buckets.set(name, [name]);
    return { rows, buckets };
  }
  const top = entries.slice(0, max - 1);
  const restEntries = entries.slice(max - 1);
  const rest = restEntries.reduce((s, [, v]) => s + v, 0);
  const rows = [
    ...top.map(([name, value]) => ({ name, value })),
    { name: otherLabel, value: rest },
  ];
  for (const [name] of top) buckets.set(name, [name]);
  buckets.set(
    otherLabel,
    restEntries.map(([name]) => name)
  );
  return { rows, buckets };
}

function txForLabels(
  txMap: Map<string, PeriodSankeyLinkTransaction[]>,
  labels: readonly string[]
): PeriodSankeyLinkTransaction[] {
  const out: PeriodSankeyLinkTransaction[] = [];
  for (const label of labels) {
    const rows = txMap.get(label);
    if (!rows?.length) continue;
    out.push(...rows);
  }
  return out.sort((a, b) => b.amount - a.amount);
}

function finalizeFromMaps(
  incomeMap: Map<string, number>,
  expenseMap: Map<string, number>,
  incomeTxMap: Map<string, PeriodSankeyLinkTransaction[]>,
  expenseTxMap: Map<string, PeriodSankeyLinkTransaction[]>,
  leftOtherLabel: string,
  rightOtherLabel: string
): PeriodSankeyData | null {
  const mergedLeft = mergeTailWithBuckets(
    incomeMap,
    MAX_NODES_PER_SIDE,
    leftOtherLabel
  );
  const mergedRight = mergeTailWithBuckets(
    expenseMap,
    MAX_NODES_PER_SIDE,
    rightOtherLabel
  );
  let left = mergedLeft.rows;
  let right = mergedRight.rows;
  const leftBuckets = mergedLeft.buckets;
  const rightBuckets = mergedRight.buckets;

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
  const links: PeriodSankeyLink[] = [];

  for (let i = 0; i < left.length; i++) {
    const row = left[i]!;
    links.push({
      source: i,
      target: centerIdx,
      value: row.value,
      transactions: txForLabels(incomeTxMap, leftBuckets.get(row.name) ?? []),
    });
  }
  for (let j = 0; j < right.length; j++) {
    const targetIdx = centerIdx + 1 + j;
    const row = right[j]!;
    links.push({
      source: centerIdx,
      target: targetIdx,
      value: row.value,
      transactions: txForLabels(expenseTxMap, rightBuckets.get(row.name) ?? []),
    });
  }

  return { nodes, links };
}

/**
 * Sankey entrate → nodo centrale → uscite per categoria nel periodo.
 * Giroconti esclusi. Se entrate ≠ uscite, nodi sintetici bilanciano il flusso.
 */
export function buildPeriodSankeyData(
  transactions: readonly Transaction[],
  range: DateRange
): PeriodSankeyData | null {
  return buildPeriodSankeyGrouped(transactions, range, {
    mode: "category",
    pinnedTags: [],
  });
}

/**
 * Come `buildPeriodSankeyData`, ma con aggregazione per **tag** su una lista
 * fissa scelta dall'utente. Se una transazione ha più tag in lista, l'importo
 * viene ripartito **in parti uguali** tra essi (nessun doppio conteggio del
 * totale). Movimenti senza tag in lista vanno in "Fuori dai tag scelti".
 */
export function buildPeriodSankeyGrouped(
  transactions: readonly Transaction[],
  range: DateRange,
  opts: { mode: SankeyGroupMode; pinnedTags: readonly string[] }
): PeriodSankeyData | null {
  if (opts.mode === "tags") {
    const pinned = [
      ...new Set(
        opts.pinnedTags.map((t) => normalizeTagLabel(t)).filter(Boolean)
      ),
    ];
    if (pinned.length === 0) return null;

    const pinnedSet = new Set(pinned);
    const incomeMap = new Map<string, number>();
    const expenseMap = new Map<string, number>();
    const incomeTxMap = new Map<string, PeriodSankeyLinkTransaction[]>();
    const expenseTxMap = new Map<string, PeriodSankeyLinkTransaction[]>();

    for (const t of transactions) {
      if (t.is_transfer) continue;
      if (!isDateInRange(t.date, range)) continue;

      const amt = Number(t.amount);
      const txTags = (t.tags ?? [])
        .map((x) => normalizeTagLabel(String(x)))
        .filter(Boolean);
      const matched = [...new Set(txTags.filter((x) => pinnedSet.has(x)))];

      if (amt > 0) {
        if (matched.length === 0) {
          const tx = {
            id: String(t.id ?? ""),
            date: String(t.date ?? ""),
            description: String(t.description ?? "Movimento"),
            merchant: t.merchant ?? null,
            amount: amt,
          };
          incomeMap.set(
            TAG_GAP_INCOME,
            (incomeMap.get(TAG_GAP_INCOME) ?? 0) + amt
          );
          pushTxContribution(incomeTxMap, TAG_GAP_INCOME, tx);
        } else {
          const share = amt / matched.length;
          for (const tag of matched) {
            incomeMap.set(tag, (incomeMap.get(tag) ?? 0) + share);
            pushTxContribution(incomeTxMap, tag, {
              id: String(t.id ?? ""),
              date: String(t.date ?? ""),
              description: String(t.description ?? "Movimento"),
              merchant: t.merchant ?? null,
              amount: share,
            });
          }
        }
      } else if (amt < 0) {
        const abs = Math.abs(amt);
        if (matched.length === 0) {
          const tx = {
            id: String(t.id ?? ""),
            date: String(t.date ?? ""),
            description: String(t.description ?? "Movimento"),
            merchant: t.merchant ?? null,
            amount: abs,
          };
          expenseMap.set(
            TAG_GAP_EXPENSE,
            (expenseMap.get(TAG_GAP_EXPENSE) ?? 0) + abs
          );
          pushTxContribution(expenseTxMap, TAG_GAP_EXPENSE, tx);
        } else {
          const share = abs / matched.length;
          for (const tag of matched) {
            expenseMap.set(tag, (expenseMap.get(tag) ?? 0) + share);
            pushTxContribution(expenseTxMap, tag, {
              id: String(t.id ?? ""),
              date: String(t.date ?? ""),
              description: String(t.description ?? "Movimento"),
              merchant: t.merchant ?? null,
              amount: share,
            });
          }
        }
      }
    }

    return finalizeFromMaps(
      incomeMap,
      expenseMap,
      incomeTxMap,
      expenseTxMap,
      "Altre entrate",
      "Altre uscite"
    );
  }

  const incomeMap = new Map<string, number>();
  const expenseMap = new Map<string, number>();
  const incomeTxMap = new Map<string, PeriodSankeyLinkTransaction[]>();
  const expenseTxMap = new Map<string, PeriodSankeyLinkTransaction[]>();

  for (const t of transactions) {
    if (t.is_transfer) continue;
    if (!isDateInRange(t.date, range)) continue;
    const amt = Number(t.amount);
    const cat = (t.category || "Altro").trim() || "Altro";
    if (amt > 0) {
      incomeMap.set(cat, (incomeMap.get(cat) ?? 0) + amt);
      pushTxContribution(incomeTxMap, cat, {
        id: String(t.id ?? ""),
        date: String(t.date ?? ""),
        description: String(t.description ?? "Movimento"),
        merchant: t.merchant ?? null,
        amount: amt,
      });
    } else if (amt < 0) {
      const abs = Math.abs(amt);
      expenseMap.set(cat, (expenseMap.get(cat) ?? 0) + abs);
      pushTxContribution(expenseTxMap, cat, {
        id: String(t.id ?? ""),
        date: String(t.date ?? ""),
        description: String(t.description ?? "Movimento"),
        merchant: t.merchant ?? null,
        amount: abs,
      });
    }
  }

  return finalizeFromMaps(
    incomeMap,
    expenseMap,
    incomeTxMap,
    expenseTxMap,
    "Altre entrate",
    "Altre uscite"
  );
}

/** Tag distinti (normalizzati) presenti nelle transazioni nel periodo. */
export function collectTagsInRange(
  transactions: readonly Transaction[],
  range: DateRange
): string[] {
  const seen = new Set<string>();
  for (const t of transactions) {
    if (t.is_transfer) continue;
    if (!isDateInRange(t.date, range)) continue;
    for (const raw of t.tags ?? []) {
      const n = normalizeTagLabel(String(raw));
      if (n) seen.add(n);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "it"));
}
