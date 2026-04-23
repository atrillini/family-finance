import { NextResponse } from "next/server";
import { TRANSACTION_CATEGORIES } from "@/lib/gemini";
import {
  recordCategorizationExample,
  recordCategorizationExamplesBatch,
  type RecordCategorizationExamplePayload,
} from "@/lib/categorization-examples";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = TRANSACTION_CATEGORIES as readonly string[];
const MAX_BATCH = 350;

function parseOne(raw: Record<string, unknown>): RecordCategorizationExamplePayload | null {
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description) return null;

  const category =
    typeof raw.category === "string" ? raw.category.trim() : "";
  if (!ALLOWED.includes(category)) return null;

  let merchant: string | null = null;
  if (typeof raw.merchant === "string") {
    const m = raw.merchant.trim();
    merchant = m.length > 0 ? m : null;
  } else if (raw.merchant === null) {
    merchant = null;
  }

  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter(Boolean)
    : [];

  const is_subscription = Boolean(raw.is_subscription);
  const is_transfer = Boolean(raw.is_transfer);

  return {
    description,
    merchant,
    category,
    tags,
    is_subscription,
    is_transfer,
  };
}

/**
 * POST /api/categorization-examples
 *
 * Body singolo: RecordCategorizationExamplePayload.
 * Body batch: `{ examples: RecordCategorizationExamplePayload[] }`.
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

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json(
      { error: "Body JSON non valido." },
      { status: 400 }
    );
  }

  const batchRaw = body.examples;
  if (Array.isArray(batchRaw)) {
    const parsed: RecordCategorizationExamplePayload[] = [];
    for (const item of batchRaw.slice(0, MAX_BATCH)) {
      if (!item || typeof item !== "object") continue;
      const one = parseOne(item as Record<string, unknown>);
      if (one) parsed.push(one);
    }
    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "Nessun esempio valido nell'array 'examples'." },
        { status: 400 }
      );
    }
    try {
      await recordCategorizationExamplesBatch(
        auth.supabase,
        auth.user.id,
        parsed
      );
      return NextResponse.json({ ok: true, count: parsed.length });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Errore durante il salvataggio.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const one = parseOne(body);
  if (!one) {
    return NextResponse.json(
      {
        error:
          "Payload non valido: atteso singolo esempio o { examples: [...] }.",
      },
      { status: 400 }
    );
  }

  try {
    await recordCategorizationExample(auth.supabase, auth.user.id, one);
    return NextResponse.json({ ok: true, count: 1 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Errore durante il salvataggio.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
