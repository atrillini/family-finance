import { NextResponse } from "next/server";
import { getRouteSupabaseAndUser, unauthorizedJson } from "@/lib/supabase/route-handler";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isAdminUserEmail } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/log-badge
 * Se l’ultimo log è `error`, `lastLogIsError: true` (badge ⚠️ accanto alla campanella).
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ admin: false, lastLogIsError: false });
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) {
    return NextResponse.json({ admin: false, lastLogIsError: false });
  }

  const email =
    auth.user.email ??
    (auth.user.user_metadata?.email as string | undefined) ??
    null;

  if (!isAdminUserEmail(email)) {
    return NextResponse.json({ admin: false, lastLogIsError: false });
  }

  const { data, error } = await auth.supabase
    .from("system_logs")
    .select("level")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ admin: true, lastLogIsError: false });
  }

  return NextResponse.json({
    admin: true,
    lastLogIsError: data?.level === "error",
  });
}
