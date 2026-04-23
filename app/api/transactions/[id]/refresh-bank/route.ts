import { NextResponse } from "next/server";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";
import { isGoCardlessConfigured } from "@/lib/gocardless";
import { isSupabaseConfigured } from "@/lib/supabase";
import { refreshSingleTransactionFromBank } from "@/lib/sync-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/transactions/:id/refresh-bank
 *
 * Scarica dalla banca una finestra stretta attorno alla data della transazione
 * e aggiorna `bank_payload`, descrizione e merchant come nello sync.
 *
 * Body opzionale: `{ windowDays?: number }` (default 1 → ±1 giorno).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  if (!isGoCardlessConfigured()) {
    return NextResponse.json(
      { error: "GoCardless non configurato sul server." },
      { status: 503 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  const { id } = await context.params;
  const transactionId = String(id ?? "").trim();
  if (!transactionId) {
    return NextResponse.json({ error: "ID mancante." }, { status: 400 });
  }

  let windowDays = 1;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      windowDays?: unknown;
    };
    const n = Number(body.windowDays);
    if (Number.isFinite(n)) {
      windowDays = Math.max(0, Math.min(7, Math.floor(n)));
    }
  } catch {
    // body vuoto: ok
  }

  try {
    const row = await refreshSingleTransactionFromBank(
      transactionId,
      auth.supabase,
      auth.user.id,
      { windowDays }
    );
    return NextResponse.json({ ok: true, transaction: row, windowDays });
  } catch (err) {
    console.error("[/api/transactions/.../refresh-bank]", err);
    const message =
      err instanceof Error ? err.message : "Errore durante il refresh banca.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
