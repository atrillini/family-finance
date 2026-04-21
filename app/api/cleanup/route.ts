import { NextResponse } from "next/server";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase";
import { getSyncFloorDate } from "@/lib/sync-floor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cleanup
 *
 * Body JSON (tutti opzionali):
 *   {
 *     before?: string,       // "YYYY-MM-DD": elimina tutto ciò che è < before.
 *                            // Default: floor configurato (SYNC_MIN_DATE,
 *                            // default 2026-01-01).
 *     accountId?: string,    // limita l'operazione a un singolo account.
 *                            // Se omesso, cancella per TUTTI i conti.
 *     dryRun?: boolean       // se true non elimina, ritorna solo il conteggio.
 *   }
 *
 * Pensato per una pulizia una-tantum: "voglio partire pulito dal 2026 in poi".
 * È idempotente: eseguirlo due volte non cambia nulla dopo il primo giro.
 *
 * Nota: usa il service role (bypassa RLS) perché si tratta di un'operazione
 * amministrativa scatenata consapevolmente dall'utente.
 */
export async function POST(request: Request) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "Supabase service role non configurato." },
      { status: 500 }
    );
  }

  let body: { before?: string; accountId?: string; dryRun?: boolean } = {};
  try {
    body = (await request.json().catch(() => ({}))) ?? {};
  } catch {
    body = {};
  }

  // Default: il floor corrente (solitamente 2026-01-01). L'utente può
  // comunque forzare un taglio diverso passando `before` nel body.
  const before = (body.before ?? "").trim() || getSyncFloorDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    return NextResponse.json(
      { error: `Formato 'before' non valido: atteso YYYY-MM-DD, ricevuto "${before}".` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdminClient();

  // Conteggio preventivo: utile sia per il dryRun sia per loggare quante
  // righe stiamo per cancellare prima di eseguire davvero il DELETE.
  let countQuery = supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .lt("date", before);
  if (body.accountId) countQuery = countQuery.eq("account_id", body.accountId);

  const { count: wouldDelete, error: countErr } = await countQuery;
  if (countErr) {
    console.error("[/api/cleanup] count failed", countErr);
    return NextResponse.json(
      { error: `Impossibile contare le transazioni: ${countErr.message}` },
      { status: 500 }
    );
  }

  if (body.dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      before,
      accountId: body.accountId ?? null,
      wouldDelete: wouldDelete ?? 0,
    });
  }

  let delQuery = supabase
    .from("transactions")
    .delete({ count: "exact" })
    .lt("date", before);
  if (body.accountId) delQuery = delQuery.eq("account_id", body.accountId);

  const { count: deleted, error: delErr } = await delQuery;
  if (delErr) {
    console.error("[/api/cleanup] delete failed", delErr);
    return NextResponse.json(
      { error: `Eliminazione fallita: ${delErr.message}` },
      { status: 500 }
    );
  }

  console.info(
    "[/api/cleanup] eliminate",
    deleted ?? 0,
    "transazioni precedenti a",
    before,
    body.accountId ? `(account ${body.accountId})` : "(tutti i conti)"
  );

  return NextResponse.json({
    ok: true,
    before,
    accountId: body.accountId ?? null,
    deleted: deleted ?? 0,
  });
}
