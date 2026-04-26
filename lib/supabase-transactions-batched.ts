import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TransactionRow } from "./supabase";

const PAGE = 500;

/**
 * Scarica tutte le transazioni per intervallo (e filtri opzionali), a lotti.
 * Evita il limite PostgREST singolo così tabella + totali usano lo stesso dataset.
 */
export async function fetchTransactionsBatched(
  supabase: SupabaseClient<Database>,
  options: {
    dateFromIso?: string;
    dateToIso?: string;
    /** Es. applicazione del filtro ricerca semantica su query Supabase */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modify?: (query: any) => any;
  }
): Promise<TransactionRow[]> {
  const out: TransactionRow[] = [];
  let offset = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from("transactions").select("*").eq("is_hidden", false);
    if (options.dateFromIso) q = q.gte("date", options.dateFromIso);
    if (options.dateToIso) q = q.lte("date", options.dateToIso);
    if (options.modify) q = options.modify(q);
    q = q.order("date", { ascending: false });
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as TransactionRow[];
    if (chunk.length === 0) break;
    out.push(...chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}
