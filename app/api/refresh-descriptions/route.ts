import { NextResponse } from "next/server";
import { isGoCardlessConfigured } from "@/lib/gocardless";
import { isSupabaseAdminConfigured } from "@/lib/supabase";
import { refreshDescriptions } from "@/lib/sync-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/refresh-descriptions
 *
 * Body JSON:
 *   {
 *     accountId: string,                  // obbligatorio
 *     recategorizeAltro?: boolean,        // opzionale, default false
 *     onlyIds?: string[]                  // opzionale: limita ai ids indicati
 *   }
 *
 * Ri-scarica le transazioni dalla banca e aggiorna SOLO `description` e
 * `merchant` sulle righe già presenti in DB. NON tocca `category`, `tags`,
 * `is_transfer`, `is_subscription`, note, amount, date.
 *
 * Se `recategorizeAltro` è true, alla fine rilancia Gemini sulle righe che
 * sono rimaste in categoria "Altro" senza tag, così vengono assorbite le
 * perdite dei primi sync fatti prima che avessimo il nuovo parser.
 */
export async function POST(request: Request) {
  if (!isGoCardlessConfigured()) {
    return NextResponse.json(
      { error: "GoCardless non è configurato." },
      { status: 500 }
    );
  }
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "Supabase service role non configurato." },
      { status: 500 }
    );
  }

  let body: {
    accountId?: string;
    recategorizeAltro?: boolean;
    onlyIds?: string[];
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

  try {
    const report = await refreshDescriptions(accountId, {
      recategorizeAltro: Boolean(body.recategorizeAltro),
      onlyIds: Array.isArray(body.onlyIds) ? body.onlyIds : undefined,
    });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    console.error("[/api/refresh-descriptions] Errore", error);
    const message =
      error instanceof Error ? error.message : "Errore sconosciuto";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
