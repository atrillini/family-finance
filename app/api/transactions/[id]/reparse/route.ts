import { NextResponse } from "next/server";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";
import { isSupabaseConfigured } from "@/lib/supabase";
import { reparseTransactionFromBankPayload } from "@/lib/sync-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/transactions/:id/reparse
 *
 * Riapplica `normalizeTransaction` al JSON salvato in `bank_payload`.
 */
export async function POST(
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
  const transactionId = String(id ?? "").trim();
  if (!transactionId) {
    return NextResponse.json({ error: "ID mancante." }, { status: 400 });
  }

  try {
    const row = await reparseTransactionFromBankPayload(
      transactionId,
      auth.supabase,
      auth.user.id
    );
    return NextResponse.json({ ok: true, transaction: row });
  } catch (err) {
    console.error("[/api/transactions/.../reparse]", err);
    const message =
      err instanceof Error ? err.message : "Errore durante il re-parse.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
