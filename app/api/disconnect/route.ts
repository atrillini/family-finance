import { NextResponse } from "next/server";
import {
  deleteRequisition,
  isGoCardlessConfigured,
} from "@/lib/gocardless";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

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
 * Richiede sessione Supabase Auth; l'account deve appartenere all'utente (`user_id`).
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

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

  const supabase = auth.supabase;

  const { data: account, error: accErr } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", auth.user.id)
    .single();

  if (accErr || !account) {
    return NextResponse.json(
      { error: `Account ${accountId} non trovato o non autorizzato.` },
      { status: 404 }
    );
  }

  let requisitionRevoked: boolean | null = null;
  if (account.requisition_id && isGoCardlessConfigured()) {
    requisitionRevoked = await deleteRequisition(account.requisition_id);
  }

  let transactionsDeleted = 0;
  if (body.deleteTransactions) {
    const { count, error: delTxErr } = await supabase
      .from("transactions")
      .delete({ count: "exact" })
      .eq("account_id", accountId)
      .eq("user_id", auth.user.id);
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

  if (body.deleteAccount) {
    const { error: delAccErr } = await supabase
      .from("accounts")
      .delete()
      .eq("id", accountId)
      .eq("user_id", auth.user.id);
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
      .eq("id", accountId)
      .eq("user_id", auth.user.id);
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
