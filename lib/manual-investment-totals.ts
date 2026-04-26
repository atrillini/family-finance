import type { ManualInvestmentRow } from "@/lib/supabase";

export function investmentTitoliValue(row: ManualInvestmentRow): number {
  return Math.max(0, Number(row.current_value) || 0);
}

export function investmentBonusValue(row: ManualInvestmentRow): number {
  return Math.max(0, Number(row.bonus_amount) || 0);
}

/** Controvalore: valore titoli (manuale o da quote) + bonus stimato sul record. */
export function investmentCountervalue(row: ManualInvestmentRow): number {
  return investmentTitoliValue(row) + investmentBonusValue(row);
}

export type MaturityProgress = {
  daysRemaining: number;
  progressPct: number;
  isPast: boolean;
};

/**
 * Avanzamento temporale verso `maturity_date` (da `created_at` a scadenza).
 * `progressPct` aumenta nel tempo fino al 100% alla data di scadenza.
 */
export function maturityProgressForRow(
  row: Pick<ManualInvestmentRow, "created_at" | "maturity_date">
): MaturityProgress | null {
  const raw = row.maturity_date;
  if (raw == null || String(raw).trim() === "") return null;
  const end = new Date(`${String(raw).slice(0, 10)}T12:00:00`).getTime();
  const start = new Date(row.created_at).getTime();
  const now = Date.now();
  if (!Number.isFinite(end) || !Number.isFinite(start) || end <= start) {
    return null;
  }
  if (now >= end) {
    return { daysRemaining: 0, progressPct: 100, isPast: true };
  }
  const daysRemaining = Math.max(0, Math.ceil((end - now) / 86_400_000));
  const total = end - start;
  const elapsed = Math.min(total, Math.max(0, now - start));
  const progressPct = Math.min(100, Math.max(0, (elapsed / total) * 100));
  return { daysRemaining, progressPct, isPast: false };
}

/** Somma dei controvalori su più posizioni. */
export function sumInvestmentCountervalues(
  rows: readonly ManualInvestmentRow[]
): number {
  return rows.reduce((s, r) => s + investmentCountervalue(r), 0);
}
