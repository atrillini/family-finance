import { NextResponse } from "next/server";
import { getRouteSupabaseAndUser, unauthorizedJson } from "@/lib/supabase/route-handler";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isAdminUserEmail } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function forbiddenJson() {
  return NextResponse.json({ error: "Non autorizzato." }, { status: 403 });
}

/**
 * GET /api/admin/logs?limit=300
 * Lista log di sistema + costo stimato ultimi 30 giorni (USD).
 */
export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase non configurato" }, { status: 500 });
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  const email =
    auth.user.email ??
    (auth.user.user_metadata?.email as string | undefined) ??
    null;
  if (!isAdminUserEmail(email)) return forbiddenJson();

  const url = new URL(request.url);
  const limit = Math.min(
    500,
    Math.max(20, Number(url.searchParams.get("limit") || "250"))
  );

  const { data: logs, error } = await auth.supabase
    .from("system_logs")
    .select("*")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: costRaw, error: rpcErr } = await auth.supabase.rpc(
    "sum_system_logs_cost",
    { p_days: 30 }
  );

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  const costLast30DaysUsd = Number(costRaw ?? 0);

  return NextResponse.json({
    logs: logs ?? [],
    costLast30DaysUsd,
  });
}

/** DELETE /api/admin/logs — svuota tutti i log dell’utente corrente. */
export async function DELETE() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase non configurato" }, { status: 500 });
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  const email =
    auth.user.email ??
    (auth.user.user_metadata?.email as string | undefined) ??
    null;
  if (!isAdminUserEmail(email)) return forbiddenJson();

  const { error } = await auth.supabase
    .from("system_logs")
    .delete()
    .eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
