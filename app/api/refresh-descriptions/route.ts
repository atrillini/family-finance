import { NextResponse } from "next/server";
import { isGoCardlessConfigured } from "@/lib/gocardless";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getRouteSupabaseAndUser, unauthorizedJson } from "@/lib/supabase/route-handler";
import { refreshDescriptions } from "@/lib/sync-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/refresh-descriptions
 *
 * Richiede sessione Supabase Auth.
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
    const report = await refreshDescriptions(
      accountId,
      {
        recategorizeAltro: Boolean(body.recategorizeAltro),
        onlyIds: Array.isArray(body.onlyIds) ? body.onlyIds : undefined,
      },
      auth.supabase,
      auth.user.id
    );
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    console.error("[/api/refresh-descriptions] Errore", error);
    const message =
      error instanceof Error ? error.message : "Errore sconosciuto";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
