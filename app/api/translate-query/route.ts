import { NextResponse } from "next/server";
import { parseNaturalLanguageQuery } from "@/lib/gemini";

export const runtime = "nodejs";

/**
 * POST /api/translate-query
 * Body: { query: string }
 * Risposta: {
 *   filter: { column, operator, value },
 *   explanation: string,
 * }
 *
 * La GEMINI_API_KEY resta server-side: il browser riceve solo il filtro parsato.
 */
export async function POST(request: Request) {
  let body: { query?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corpo della richiesta non valido." },
      { status: 400 }
    );
  }

  const query = typeof body.query === "string" ? body.query : "";
  if (!query.trim()) {
    return NextResponse.json(
      { error: "Il campo 'query' è obbligatorio." },
      { status: 400 }
    );
  }

  try {
    const parsed = await parseNaturalLanguageQuery(query);
    if (!parsed) {
      return NextResponse.json(
        { error: "Non sono riuscito a interpretare la richiesta." },
        { status: 422 }
      );
    }
    return NextResponse.json(parsed);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore sconosciuto dal servizio AI.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
