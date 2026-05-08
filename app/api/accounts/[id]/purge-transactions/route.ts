import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/accounts/:id/purge-transactions
 *
 * Elimina TUTTE le transazioni associate all'account indicato senza toccare
 * il record account né i collegamenti GoCardless.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  const { id } = await context.params;
  const accountId = String(id ?? "").trim();
  if (!accountId) {
    return NextResponse.json({ error: "ID conto mancante." }, { status: 400 });
  }

  const { data: account, error: accErr } = await auth.supabase
    .from("accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", auth.user.id)
    .single();
  if (accErr || !account) {
    return NextResponse.json({ error: "Conto non trovato." }, { status: 404 });
  }

  const { count, error: delErr } = await auth.supabase
    .from("transactions")
    .delete({ count: "exact" })
    .eq("account_id", accountId)
    .eq("user_id", auth.user.id);

  if (delErr) {
    return NextResponse.json(
      { error: `Impossibile eliminare le transazioni: ${delErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    accountId,
    transactionsDeleted: count ?? 0,
  });
}

