import { NextResponse } from "next/server";
import { fetchUnitQuoteByIsin, normalizeIsin } from "@/lib/twelve-data-quote";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  if (!(await getRouteSupabaseAndUser())) return unauthorizedJson();

  const apiKey = (process.env.TWELVE_DATA_API_KEY ?? "").trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Chiave Twelve Data mancante. Aggiungi TWELVE_DATA_API_KEY in .env.local (piano gratuito su twelvedata.com).",
      },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Payload non valido." }, { status: 400 });
  }

  const isinRaw = typeof body.isin === "string" ? body.isin : "";
  const qtyRaw = body.quantity;
  const quantity =
    typeof qtyRaw === "number" && Number.isFinite(qtyRaw)
      ? qtyRaw
      : typeof qtyRaw === "string" && qtyRaw.trim()
        ? Number(qtyRaw.replace(",", "."))
        : null;

  if (!normalizeIsin(isinRaw)) {
    return NextResponse.json(
      { error: "ISIN non valido (12 caratteri, es. IE00B4L5Y983)." },
      { status: 400 }
    );
  }

  try {
    const quote = await fetchUnitQuoteByIsin(isinRaw, apiKey);
    let currentValue: number | null = null;
    if (
      quantity != null &&
      Number.isFinite(quantity) &&
      quantity > 0
    ) {
      currentValue = Math.round(quantity * quote.unitPrice * 100) / 100;
    }

    return NextResponse.json({
      ok: true as const,
      quote,
      currentValue,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore quotazione.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
