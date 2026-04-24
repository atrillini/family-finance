import { normalizeTagLabel } from "@/lib/tag-colors";
import { isDateInRange, type DateRange } from "@/lib/date-range";
import type { Transaction } from "@/lib/mock-data";

export type CategoryExpenseShare = {
  category: string;
  amount: number;
  /** Quota sulle sole uscite del periodo, 0–100. */
  sharePct: number;
};

export type TagExpenseShare = {
  tag: string;
  amount: number;
  /** Quota sulle sole uscite del periodo, 0–100. */
  sharePct: number;
};

/**
 * Uscite aggregate per categoria nel range (giroconti esclusi, solo amount &lt; 0).
 */
export function aggregateExpenseByCategory(
  transactions: readonly Transaction[],
  range: DateRange,
  opts?: { maxCategories?: number }
): CategoryExpenseShare[] {
  const maxCategories = opts?.maxCategories ?? 10;
  const map = new Map<string, number>();
  let total = 0;

  for (const t of transactions) {
    if (t.is_transfer) continue;
    if (Number(t.amount) >= 0) continue;
    if (!isDateInRange(t.date, range)) continue;
    const amt = Math.abs(Number(t.amount));
    total += amt;
    const c = (t.category || "Altro").trim() || "Altro";
    map.set(c, (map.get(c) ?? 0) + amt);
  }

  return [...map.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      sharePct: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, maxCategories);
}

/**
 * Uscite aggregate per tag: su ogni transazione l'importo viene ripartito in parti
 * uguali tra i tag (così la somma delle quote per tag coincide con le uscite totali).
 * Transazioni senza tag contano in "(senza tag)".
 */
export function aggregateExpenseByTag(
  transactions: readonly Transaction[],
  range: DateRange,
  opts?: { maxTags?: number }
): TagExpenseShare[] {
  const maxTags = opts?.maxTags ?? 12;
  const map = new Map<string, number>();
  let total = 0;

  for (const t of transactions) {
    if (t.is_transfer) continue;
    if (Number(t.amount) >= 0) continue;
    if (!isDateInRange(t.date, range)) continue;
    const amt = Math.abs(Number(t.amount));
    total += amt;
    const raw = Array.isArray(t.tags) ? t.tags : [];
    const tags = raw
      .map((x) => normalizeTagLabel(String(x)))
      .filter((x) => x.length > 0);
    if (tags.length === 0) {
      const k = "(senza tag)";
      map.set(k, (map.get(k) ?? 0) + amt);
    } else {
      const share = amt / tags.length;
      for (const tag of tags) {
        map.set(tag, (map.get(tag) ?? 0) + share);
      }
    }
  }

  return [...map.entries()]
    .map(([tag, amount]) => ({
      tag,
      amount,
      sharePct: total > 0 ? (amount / total) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, maxTags);
}
