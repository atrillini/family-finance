import { NextResponse } from "next/server";
import {
  getGoCardlessClient,
  isGoCardlessConfigured,
  resolveRequisitionId,
} from "@/lib/gocardless";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getRouteSupabaseAndUser } from "@/lib/supabase/route-handler";
import { upsertAccountFromRequisition } from "@/lib/sync-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequisitionResponse = {
  id?: string;
  status?: string;
  institution_id?: string;
  accounts?: string[];
  reference?: string;
  link?: string;
};

type InstitutionResponse = {
  id?: string;
  name?: string;
  logo?: string;
};

/**
 * GET /api/callback?ref=<requisitionId>
 *
 * Rotta di ritorno dopo il consenso bancario. GoCardless redirige qui con
 * l'ID della requisition (può chiamarsi `ref`, `requisition_id` o `id` a
 * seconda della configurazione del link iniziale).
 *
 * Cosa fa:
 *  1. Recupera la requisition da GoCardless.
 *  2. Per ogni account autorizzato, crea/aggiorna un record su `accounts`
 *     salvando `requisition_id`, `institution_id`, `gocardless_account_id`,
 *     IBAN e saldo iniziale.
 *  3. Redirige l'utente alla dashboard con un flash di conferma.
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
      {
        error:
          "Supabase non configurato. Imposta NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      },
      { status: 500 }
    );
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", "/");
    loginUrl.searchParams.set("reason", "session");
    return NextResponse.redirect(loginUrl);
  }

  const url = new URL(request.url);
  // GoCardless mette qui il `reference` che abbiamo passato a initSession,
  // NON il requisitionId. Lo risolviamo più sotto con `resolveRequisitionId`.
  const refParam =
    url.searchParams.get("ref") ||
    url.searchParams.get("requisition_id") ||
    url.searchParams.get("id");

  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    console.warn("[/api/callback] errore dal provider:", errorParam);
    return NextResponse.redirect(
      new URL(`/?bank=error&reason=${encodeURIComponent(errorParam)}`, request.url)
    );
  }

  if (!refParam) {
    return NextResponse.json(
      { error: "requisition id mancante (parametro ref)" },
      { status: 400 }
    );
  }

  try {
    const client = await getGoCardlessClient();
    console.info(
      "[/api/callback] ricevuto ref=",
      refParam,
      "(risolvo in requisitionId)"
    );

    const requisitionId = await resolveRequisitionId(refParam);
    if (!requisitionId) {
      const msg = `Requisition non trovata per ref=${refParam}`;
      console.error("[/api/callback]", msg);
      const redirectUrl = new URL("/", request.url);
      redirectUrl.searchParams.set("bank", "error");
      redirectUrl.searchParams.set("reason", msg);
      return NextResponse.redirect(redirectUrl);
    }

    console.info("[/api/callback] retrieving requisition", requisitionId);
    const requisition = (await client.requisition.getRequisitionById(
      requisitionId
    )) as RequisitionResponse;

    console.info("[/api/callback] requisition status", {
      id: requisition?.id,
      status: requisition?.status,
      institution_id: requisition?.institution_id,
      accounts: requisition?.accounts,
    });

    if (!requisition?.accounts || requisition.accounts.length === 0) {
      console.warn(
        "[/api/callback] nessun account nella requisition",
        requisitionId
      );
      return NextResponse.redirect(
        new URL(
          `/?bank=pending&requisition=${encodeURIComponent(requisitionId)}`,
          request.url
        )
      );
    }

    const institutionId = requisition.institution_id ?? "";

    let institutionName: string | null = null;
    let institutionLogo: string | null = null;
    if (institutionId) {
      try {
        const institution = (await client.institution.getInstitutionById(
          institutionId
        )) as InstitutionResponse;
        institutionName = institution?.name ?? null;
        institutionLogo = institution?.logo ?? null;
      } catch (e) {
        console.warn(
          "[/api/callback] impossibile leggere l'istituto",
          institutionId,
          e
        );
      }
    }

    const results: Array<{ accountId: string; name: string }> = [];
    for (const gocardlessAccountId of requisition.accounts) {
      console.info(
        "[/api/callback] upsert account",
        gocardlessAccountId,
        "→ Supabase (requisition",
        requisitionId + ")"
      );
      const row = await upsertAccountFromRequisition(auth.supabase, {
        gocardlessAccountId,
        requisitionId,
        institutionId,
        institutionName,
        institutionLogo,
        userId: auth.user.id,
      });
      console.info("[/api/callback] account salvato:", {
        id: row.id,
        name: row.name,
        gocardless_account_id: row.gocardless_account_id,
        requisition_id: row.requisition_id,
      });
      results.push({ accountId: row.id, name: row.name });
    }

    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set("bank", "connected");
    redirectUrl.searchParams.set("count", String(results.length));
    redirectUrl.searchParams.set("requisition", requisitionId);
    console.info(
      "[/api/callback] redirect a",
      redirectUrl.pathname + redirectUrl.search
    );
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("[/api/callback] Errore", error);
    const message =
      error instanceof Error ? error.message : "Errore sconosciuto";
    const redirectUrl = new URL("/", request.url);
    redirectUrl.searchParams.set("bank", "error");
    redirectUrl.searchParams.set("reason", message.slice(0, 200));
    return NextResponse.redirect(redirectUrl);
  }
}
