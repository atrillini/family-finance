import { NextResponse } from "next/server";
import {
  isGoCardlessConfigured,
  listInstitutions,
} from "@/lib/gocardless";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/banks?country=IT
 *
 * Ritorna l'elenco delle banche disponibili tramite GoCardless Bank Account Data
 * per il paese indicato (default: Italia).
 *
 * Risposta: { country: string, banks: [{ id, name, logo, bic, ... }] }
 */
export async function GET(request: Request) {
  if (!isGoCardlessConfigured()) {
    return NextResponse.json(
      {
        error:
          "GoCardless non è configurato. Imposta GOCARDLESS_SECRET_ID e GOCARDLESS_SECRET_KEY in .env.local.",
      },
      { status: 500 }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  if (!(await getRouteSupabaseAndUser())) return unauthorizedJson();

  const url = new URL(request.url);
  const country = (url.searchParams.get("country") || "IT")
    .trim()
    .toUpperCase();

  try {
    const banks = await listInstitutions(country);
    return NextResponse.json(
      { country, banks },
      {
        headers: {
          "Cache-Control": "private, max-age=300",
        },
      }
    );
  } catch (error) {
    console.error("[/api/banks] Errore GoCardless", error);
    const message =
      error instanceof Error ? error.message : "Errore sconosciuto";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
