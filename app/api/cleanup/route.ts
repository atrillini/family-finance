import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";
import { getSyncFloorDate } from "@/lib/sync-floor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cleanup
 *
 * Elimina transazioni dell'utente corrente con `date` &lt; `before`.
 * Opzionale `accountId`: deve essere un conto di proprietà dell'utente.
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

  let body: { before?: string; accountId?: string; dryRun?: boolean } = {};
  try {
    body = (await request.json().catch(() => ({}))) ?? {};
  } catch {
    body = {};
  }

  const before = (body.before ?? "").trim() || getSyncFloorDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    return NextResponse.json(
      {
        error: `Formato 'before' non valido: atteso YYYY-MM-DD, ricevuto "${before}".`,
      },
      { status: 400 }
    );
  }

  const supabase = auth.supabase;
  const userId = auth.user.id;

  if (body.accountId) {
    const accId = body.accountId.trim();
    const { data: acc, error: accErr } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accId)
      .eq("user_id", userId)
      .maybeSingle();
    if (accErr || !acc) {
      return NextResponse.json(
        { error: "accountId non trovato o non autorizzato." },
        { status: 404 }
      );
    }
  }

  let countQuery = supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .lt("date", before)
    .eq("user_id", userId);
  if (body.accountId) {
    countQuery = countQuery.eq("account_id", body.accountId.trim());
  }

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
    .lt("date", before)
    .eq("user_id", userId);
  if (body.accountId) {
    delQuery = delQuery.eq("account_id", body.accountId.trim());
  }

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
    body.accountId ? `(account ${body.accountId})` : "(tutti i conti dell'utente)"
  );

  return NextResponse.json({
    ok: true,
    before,
    accountId: body.accountId ?? null,
    deleted: deleted ?? 0,
  });
}
