import { NextResponse } from "next/server";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase";
import { validateRulePayload } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/rules/:id → aggiorna una regola esistente. */
export async function PATCH(request: Request, { params }: Params) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "Supabase service role non configurato." },
      { status: 500 }
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: "id mancante nel path" },
      { status: 400 }
    );
  }

  let body: Record<string, unknown> = {};
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

  const supabase = getSupabaseAdminClient();
  const { data, error, count } = await supabase
    .from("categorization_rules")
    .update(
      { ...validation.value, updated_at: new Date().toISOString() },
      { count: "exact" }
    )
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data || count === 0) {
    return NextResponse.json(
      {
        error:
          error?.message ??
          `Regola ${id} non trovata o RLS sta bloccando l'UPDATE.`,
      },
      { status: 404 }
    );
  }
  return NextResponse.json({ rule: data });
}

/** DELETE /api/rules/:id */
export async function DELETE(_request: Request, { params }: Params) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      { error: "Supabase service role non configurato." },
      { status: 500 }
    );
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: "id mancante nel path" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdminClient();
  const { error, count } = await supabase
    .from("categorization_rules")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json(
      { error: `Regola ${id} non trovata (o bloccata da RLS).` },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, deleted: count });
}
