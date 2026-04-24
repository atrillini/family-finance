import { NextResponse } from "next/server";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";
import { isSupabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/accounts/last-sync
 * Risposta: { lastSyncAt: string | null } — max(last_sync_at) sui conti dell'utente.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ lastSyncAt: null });
  }

  const ctx = await getRouteSupabaseAndUser();
  if (!ctx) return unauthorizedJson();

  const { data, error } = await ctx.supabase
    .from("accounts")
    .select("last_sync_at")
    .eq("user_id", ctx.user.id);

  if (error || !data?.length) {
    return NextResponse.json({ lastSyncAt: null });
  }

  let max: string | null = null;
  for (const row of data) {
    const t = row.last_sync_at;
    if (!t) continue;
    if (!max || new Date(t).getTime() > new Date(max).getTime()) max = t;
  }

  return NextResponse.json({ lastSyncAt: max });
}
