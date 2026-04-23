import { NextResponse } from "next/server";
import { getRouteSupabaseAndUser, unauthorizedJson } from "@/lib/supabase/route-handler";
import { isSupabaseConfigured } from "@/lib/supabase";
import { ensureConsentExpiryNotifications } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/notifications?limit=40&warmConsent=1
 * Lista notifiche recenti + conteggio non lette.
 * Se `warmConsent=1`, aggiorna i promemoria su consensi GoCardless in scadenza (dedup lato DB).
 */
export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase non configurato" }, { status: 500 });
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  const url = new URL(request.url);
  const limit = Math.min(
    80,
    Math.max(5, Number(url.searchParams.get("limit") || "40"))
  );

  if (url.searchParams.get("warmConsent") === "1") {
    await ensureConsentExpiryNotifications(auth.supabase, auth.user.id).catch(
      (e) => console.warn("[notifications GET] warmConsent", e)
    );
  }

  const { data: notifications, error } = await auth.supabase
    .from("notifications")
    .select("id, type, title, message, is_read, created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  const { count: unreadCount, error: countErr } = await auth.supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.user.id)
    .eq("is_read", false);

  if (countErr) {
    return NextResponse.json(
      { error: countErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    notifications: notifications ?? [],
    unreadCount: unreadCount ?? 0,
  });
}

/**
 * PATCH /api/notifications
 * Body: { ids?: string[], markAllRead?: boolean }
 */
export async function PATCH(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase non configurato" }, { status: 500 });
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  let body: { ids?: string[]; markAllRead?: boolean } = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  if (body.markAllRead) {
    const { error } = await auth.supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", auth.user.id)
      .eq("is_read", false);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.map((id) => String(id).trim()).filter(Boolean)
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Specificare ids o markAllRead" },
      { status: 400 }
    );
  }

  const { error } = await auth.supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", auth.user.id)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
