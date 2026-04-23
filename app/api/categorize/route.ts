import { NextResponse } from "next/server";
import {
  analyzeTransaction,
  buildAnalyzeTransactionContext,
} from "@/lib/gemini";
import {
  formatExamplesForPrompt,
  loadCategorizationExamples,
} from "@/lib/categorization-examples";
import {
  formatRulesForPrompt,
  loadCategorizationRules,
} from "@/lib/categorization-rules";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

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
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

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
    const rules = await loadCategorizationRules(auth.supabase, auth.user.id);
    const examples = await loadCategorizationExamples(auth.supabase, auth.user.id);
    const aiContext = buildAnalyzeTransactionContext(
      formatRulesForPrompt(rules),
      formatExamplesForPrompt(examples)
    );

    const analysis = await analyzeTransaction(description, aiContext);
    return NextResponse.json(analysis);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore sconosciuto dal servizio AI.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
