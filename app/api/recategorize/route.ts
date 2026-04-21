import { NextResponse } from "next/server";
import { isSupabaseAdminConfigured } from "@/lib/supabase";
import { recategorizeTransaction } from "@/lib/sync-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/recategorize
 *
 * Body: { transactionId: string }
 *
 * Riesegue Gemini su una transazione già presente a DB e aggiorna i campi
 * `category`, `merchant`, `tags`, `is_subscription`. Usato dal pulsante
 * "Ricategorizza con IA" nella tabella transazioni.
 *
 * Richiede la service-role key perché scrive saltando RLS (stessa semantica
 * di `/api/sync`).
 */
export async function POST(request: Request) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "Supabase service role non configurato." },
      { status: 500 }
    );
  }

  let body: { transactionId?: string; transactionIds?: string[] } = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json(
      { error: "Body JSON non valido" },
      { status: 400 }
    );
  }

  // Supporto per ricategorizzazione singola e batch. Quando arriva l'array
  // lo processiamo in serie (la concorrenza verso Gemini è già limitata a
  // livello di modulo in `sync-transactions` → qui teniamo la serializzazione
  // così un 429 su una transazione non affonda l'intero batch).
  const ids = Array.isArray(body.transactionIds)
    ? body.transactionIds.map((s) => String(s).trim()).filter(Boolean)
    : body.transactionId
    ? [String(body.transactionId).trim()]
    : [];

  if (ids.length === 0) {
    return NextResponse.json(
      { error: "transactionId o transactionIds è obbligatorio" },
      { status: 400 }
    );
  }

  if (ids.length === 1) {
    try {
      const row = await recategorizeTransaction(ids[0]);
      return NextResponse.json({ ok: true, transaction: row });
    } catch (err) {
      console.error("[/api/recategorize] errore", err);
      const message =
        err instanceof Error ? err.message : "Errore sconosciuto";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const results: Array<
    | { id: string; ok: true; transaction: Awaited<ReturnType<typeof recategorizeTransaction>> }
    | { id: string; ok: false; error: string }
  > = [];

  for (const id of ids) {
    try {
      const row = await recategorizeTransaction(id);
      results.push({ id, ok: true, transaction: row });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Errore sconosciuto";
      console.error("[/api/recategorize] batch KO su", id, message);
      results.push({ id, ok: false, error: message });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: okCount === ids.length,
    total: ids.length,
    okCount,
    failCount: ids.length - okCount,
    results,
  });
}
