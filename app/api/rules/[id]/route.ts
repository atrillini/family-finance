import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";
import { validateRulePayload } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** PATCH /api/rules/:id → aggiorna una regola dell'utente corrente. */
export async function PATCH(request: Request, { params }: Params) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

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

  const { data, error } = await auth.supabase
    .from("categorization_rules")
    .update({
      ...validation.value,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      {
        error:
          error?.message ??
          `Regola ${id} non trovata o non autorizzata.`,
      },
      { status: 404 }
    );
  }
  return NextResponse.json({ rule: data });
}

/** DELETE /api/rules/:id */
export async function DELETE(_request: Request, { params }: Params) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { error: "id mancante nel path" },
      { status: 400 }
    );
  }

  const { error, count } = await auth.supabase
    .from("categorization_rules")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", auth.user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!count) {
    return NextResponse.json(
      { error: `Regola ${id} non trovata o non autorizzata.` },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, deleted: count });
}
