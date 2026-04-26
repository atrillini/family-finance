import type { TransactionRow } from "@/lib/supabase";

/** Transazioni visibili in UI, grafici e prompt IA (soft delete = is_hidden true). */
export function isTransactionVisible(
  row: Pick<TransactionRow, "is_hidden"> | { is_hidden?: boolean | null }
): boolean {
  return row.is_hidden !== true;
}
