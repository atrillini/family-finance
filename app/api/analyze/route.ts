import { NextResponse } from "next/server";
import {
  analyzeFinance,
  coerceFinanceTxFromJson,
  type AnalyzeContext,
  type FinanceTx,
} from "@/lib/gemini";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";

/**
 * POST /api/analyze
 * Body: {
 *   query: string,
 *   transactions: FinanceTx[] (description, amount, category, date, tags, merchant),
 *   dateRange?: { fromIso: string, toIso: string, label?: string } | null
 * }
 * Risposta: { answer: string } (Markdown)
 *
 * Il client invia la sintesi delle transazioni (inclusi `tags` e `merchant`)
 * insieme alla domanda; la GEMINI_API_KEY resta solo sul server.
 * Se presente, `dateRange` viene
 * iniettato nel system prompt in modo che domande senza riferimenti
 * temporali espliciti ("quanto ho speso?") vengano interpretate rispetto
 * al periodo attualmente selezionato nella dashboard.
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  if (!(await getRouteSupabaseAndUser())) return unauthorizedJson();

  let body: {
    query?: unknown;
    transactions?: unknown;
    dateRange?: unknown;
  };
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

  const rawTxs = Array.isArray(body.transactions) ? body.transactions : [];
  const transactions: FinanceTx[] = rawTxs
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map((t) => coerceFinanceTxFromJson(t));

  let context: AnalyzeContext | undefined;
  if (body.dateRange && typeof body.dateRange === "object") {
    const r = body.dateRange as Record<string, unknown>;
    const fromIso = typeof r.fromIso === "string" ? r.fromIso : "";
    const toIso = typeof r.toIso === "string" ? r.toIso : "";
    if (fromIso && toIso) {
      context = {
        dateRange: {
          fromIso,
          toIso,
          label: typeof r.label === "string" ? r.label : undefined,
        },
      };
    }
  }

  try {
    const answer = await analyzeFinance(query, transactions, context);
    if (!answer) {
      return NextResponse.json(
        { error: "Non sono riuscito a generare una risposta." },
        { status: 422 }
      );
    }
    return NextResponse.json({ answer });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore sconosciuto dal servizio AI.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
