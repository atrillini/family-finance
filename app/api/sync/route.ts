import { NextResponse } from "next/server";
import { isGoCardlessConfigured } from "@/lib/gocardless";
import { getRouteSupabaseAndUser, unauthorizedJson } from "@/lib/supabase/route-handler";
import { isSupabaseConfigured } from "@/lib/supabase";
import { syncTransactions } from "@/lib/sync-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sync
 *
 * Body JSON: { accountId: string }
 *
 * Scarica le transazioni bancarie dell'account indicato, le categorizza con
 * Gemini ed esegue l'upsert su `transactions` evitando duplicati. Aggiorna
 * anche saldo e `last_sync_at` sul record `accounts`.
 *
 * Richiede sessione Supabase Auth (cookie).
 */
export async function POST(request: Request) {
  if (!isGoCardlessConfigured()) {
    return NextResponse.json(
      { error: "GoCardless non è configurato." },
      { status: 500 }
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  let body: { accountId?: string } = {};
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

  try {
    const report = await syncTransactions(
      accountId,
      auth.supabase,
      auth.user.id
    );
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    console.error("[/api/sync] Errore", error);
    const message =
      error instanceof Error ? error.message : "Errore sconosciuto";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
