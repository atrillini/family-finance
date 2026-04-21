import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { CategorizationRuleRow } from "@/lib/supabase";
import { TRANSACTION_CATEGORIES } from "@/lib/gemini";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MATCH_TYPES = [
  "description_contains",
  "merchant_contains",
  "description_regex",
] as const;

type IncomingRule = Partial<
  Pick<
    CategorizationRuleRow,
    | "match_type"
    | "pattern"
    | "category"
    | "tags"
    | "merchant"
    | "is_subscription"
    | "is_transfer"
    | "priority"
    | "note"
  >
>;

/** GET /api/rules → lista le regole dell'utente corrente. */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  const { data, error } = await auth.supabase
    .from("categorization_rules")
    .select("*")
    .eq("user_id", auth.user.id)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ rules: data ?? [] });
}

/** POST /api/rules → crea una nuova regola per l'utente corrente. */
export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  let body: IncomingRule = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json(
      { error: "Body JSON non valido" },
      { status: 400 }
    );
  }

  const validation = validateRulePayload(body);
  if ("error" in validation) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("categorization_rules")
    .insert({
      ...validation.value,
      user_id: auth.user.id,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Errore sconosciuto" },
      { status: 500 }
    );
  }
  return NextResponse.json({ rule: data });
}

type ValidatedRule = {
  match_type: (typeof MATCH_TYPES)[number];
  pattern: string;
  category: (typeof TRANSACTION_CATEGORIES)[number];
  tags: string[];
  merchant: string | null;
  is_subscription: boolean;
  is_transfer: boolean;
  priority: number;
  note: string | null;
};

export function validateRulePayload(
  body: IncomingRule
): { value: ValidatedRule } | { error: string } {
  const pattern = String(body.pattern ?? "").trim();
  if (!pattern) return { error: "pattern è obbligatorio" };

  const match_type = MATCH_TYPES.includes(
    body.match_type as (typeof MATCH_TYPES)[number]
  )
    ? (body.match_type as (typeof MATCH_TYPES)[number])
    : "description_contains";

  if (match_type === "description_regex") {
    try {
      new RegExp(pattern);
    } catch {
      return { error: "pattern regex non valida" };
    }
  }

  const rawCategory = String(body.category ?? "Altro");
  const category =
    (TRANSACTION_CATEGORIES as readonly string[]).find(
      (c) => c.toLowerCase() === rawCategory.toLowerCase()
    ) ?? "Altro";

  const tags = Array.isArray(body.tags)
    ? body.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
        .slice(0, 6)
    : [];

  const merchant =
    typeof body.merchant === "string" && body.merchant.trim()
      ? body.merchant.trim()
      : null;

  const note =
    typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

  const priority = Number.isFinite(Number(body.priority))
    ? Math.max(0, Math.min(1000, Math.trunc(Number(body.priority))))
    : 0;

  return {
    value: {
      match_type,
      pattern,
      category: category as (typeof TRANSACTION_CATEGORIES)[number],
      tags,
      merchant,
      is_subscription: Boolean(body.is_subscription),
      is_transfer: Boolean(body.is_transfer),
      priority,
      note,
    },
  };
}
