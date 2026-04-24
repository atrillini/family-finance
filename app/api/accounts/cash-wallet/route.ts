import { NextResponse } from "next/server";
import {
  CASH_WALLET_NAME,
  CASH_WALLET_TYPE,
} from "@/lib/cash-wallet";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";

/**
 * POST /api/accounts/cash-wallet
 * Garantisce un conto "Contanti" (tipo `contanti`) per l'utente corrente.
 * Idempotente: se esiste già, restituisce il primo match per nome (case-insensitive).
 */
export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  const { supabase, user } = auth;

  const { data: existingRows, error: selErr } = await supabase
    .from("accounts")
    .select("*")
    .eq("user_id", user.id)
    .ilike("name", CASH_WALLET_NAME)
    .order("created_at", { ascending: true })
    .limit(1);

  if (selErr) {
    return NextResponse.json(
      { error: selErr.message },
      { status: 500 }
    );
  }

  const existing = existingRows?.[0];
  if (existing) {
    return NextResponse.json({ account: existing, created: false });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("accounts")
    .insert({
      name: CASH_WALLET_NAME,
      type: CASH_WALLET_TYPE,
      user_id: user.id,
    })
    .select("*")
    .single();

  if (insErr) {
    const { data: againRows } = await supabase
      .from("accounts")
      .select("*")
      .eq("user_id", user.id)
      .ilike("name", CASH_WALLET_NAME)
      .order("created_at", { ascending: true })
      .limit(1);
    const again = againRows?.[0];
    if (again) {
      return NextResponse.json({ account: again, created: false });
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ account: inserted, created: true });
}
