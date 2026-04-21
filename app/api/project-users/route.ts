import { NextResponse } from "next/server";
import { isSupabaseAdminConfigured, getSupabaseAdminClient } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Elenca gli utenti Supabase Auth (Admin API). Richiede sessione + service role in .env.
 * L'elenco completo non è esponibile con la sola chiave anon: serve `SUPABASE_SERVICE_ROLE_KEY`.
 */
export async function GET() {
  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({
      ok: true,
      listSupported: false,
      hint:
        "Aggiungi SUPABASE_SERVICE_ROLE_KEY in .env.local per vedere qui tutti gli utenti registrati, oppure usa Authentication → Users nel pannello Supabase.",
      users: [] as Array<{
        id: string;
        email: string | undefined;
        created_at: string | undefined;
        last_sign_in_at: string | undefined;
      }>,
    });
  }

  try {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 100,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 502 }
      );
    }

    const users =
      data?.users?.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      })) ?? [];

    return NextResponse.json({
      ok: true,
      listSupported: true,
      users,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore lista utenti";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
