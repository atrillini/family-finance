import { NextResponse } from "next/server";
import {
  deleteRequisition,
  isGoCardlessConfigured,
} from "@/lib/gocardless";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/disconnect
 *
 * Body JSON:
 *   {
 *     accountId: string,
 *     deleteTransactions?: boolean, // default false
 *     deleteAccount?: boolean       // default false — se true elimina anche la card del conto
 *   }
 *
 * Cosa fa:
 *   1. cancella la requisition su GoCardless (revoca del consenso bancario)
 *   2. azzera i campi `requisition_id`, `institution_id`, `gocardless_account_id`
 *      così il conto resta visibile ma torna "manuale"
 *   3. se `deleteTransactions`, elimina tutte le transazioni linkate all'account
 *   4. se `deleteAccount`, elimina il record `accounts` (e il `ON DELETE SET NULL`
 *      su `transactions.account_id` scollega automaticamente le righe residue)
 *
 * Ritorna un mini-report con i conteggi.
 */
export async function POST(request: Request) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "Supabase service role non configurato." },
      { status: 500 }
    );
  }

  let body: {
    accountId?: string;
    deleteTransactions?: boolean;
    deleteAccount?: boolean;
  } = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json(
      { error: "Body JSON non valido" },
      { status: 400 }
    );
  }

  const accountId = (body.accountId ?? "").trim();
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId è obbligatorio" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdminClient();

  const { data: account, error: accErr } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (accErr || !account) {
    return NextResponse.json(
      { error: `Account ${accountId} non trovato: ${accErr?.message ?? ""}` },
      { status: 404 }
    );
  }

  // 1) revoca il consenso su GoCardless (best-effort: non facciamo fallire
  //    il flusso se la requisition non esiste più).
  let requisitionRevoked: boolean | null = null;
  if (account.requisition_id && isGoCardlessConfigured()) {
    requisitionRevoked = await deleteRequisition(account.requisition_id);
  }

  // 2) transazioni collegate (opzionale)
  let transactionsDeleted = 0;
  if (body.deleteTransactions) {
    const { count, error: delTxErr } = await supabase
      .from("transactions")
      .delete({ count: "exact" })
      .eq("account_id", accountId);
    if (delTxErr) {
      return NextResponse.json(
        {
          error: `Impossibile eliminare le transazioni: ${delTxErr.message}`,
        },
        { status: 500 }
      );
    }
    transactionsDeleted = count ?? 0;
  }

  // 3) elimina account oppure scollegalo dai campi GoCardless
  if (body.deleteAccount) {
    const { error: delAccErr } = await supabase
      .from("accounts")
      .delete()
      .eq("id", accountId);
    if (delAccErr) {
      return NextResponse.json(
        {
          error: `Impossibile eliminare l'account: ${delAccErr.message}`,
        },
        { status: 500 }
      );
    }
  } else {
    const { error: updErr } = await supabase
      .from("accounts")
      .update({
        requisition_id: null,
        institution_id: null,
        gocardless_account_id: null,
        last_sync_at: null,
      })
      .eq("id", accountId);
    if (updErr) {
      return NextResponse.json(
        {
          error: `Impossibile aggiornare l'account: ${updErr.message}`,
        },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    accountId,
    accountDeleted: Boolean(body.deleteAccount),
    requisitionRevoked,
    transactionsDeleted,
  });
}
