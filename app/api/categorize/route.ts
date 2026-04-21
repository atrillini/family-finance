import { NextResponse } from "next/server";
import { analyzeTransaction } from "@/lib/gemini";

export const runtime = "nodejs";

/**
 * POST /api/categorize
 * Body: { description: string }
 * Risposta: {
 *   category: TransactionCategory,
 *   merchant: string,
 *   tags: string[],
 *   is_subscription: boolean,
 * }
 *
 * Endpoint server-side che incapsula la chiamata a Gemini così che la
 * GEMINI_API_KEY non venga mai esposta al browser.
 */
export async function POST(request: Request) {
  let body: { description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Corpo della richiesta non valido." },
      { status: 400 }
    );
  }

  const description = typeof body.description === "string" ? body.description : "";
  if (!description.trim()) {
    return NextResponse.json(
      { error: "Il campo 'description' è obbligatorio." },
      { status: 400 }
    );
  }

  try {
    const analysis = await analyzeTransaction(description);
    return NextResponse.json(analysis);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore sconosciuto dal servizio AI.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
