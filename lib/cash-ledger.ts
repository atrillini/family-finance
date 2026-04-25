import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase";

/**
 * Somma `amount` di tutte le transazioni per conto (saldo a partita doppia).
 * Usato per il conto "Contanti" dove `accounts.balance` non viene aggiornato dal sync.
 */
export async function fetchCashLedgerTotals(
  supabase: SupabaseClient<Database>,
  accountIds: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of accountIds) out[id] = 0;
  if (accountIds.length === 0) return out;

  const { data, error } = await supabase
    .from("transactions")
    .select("account_id, amount")
    .in("account_id", accountIds);

  if (error) throw error;
  for (const row of data ?? []) {
    const aid = row.account_id as string;
    if (!(aid in out)) continue;
    out[aid] = (out[aid] ?? 0) + Number(row.amount);
  }
  return out;
}
