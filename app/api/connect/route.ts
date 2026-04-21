import { NextResponse } from "next/server";
import {
  createConsentSession,
  getDefaultRedirectUrl,
  isGoCardlessConfigured,
} from "@/lib/gocardless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/connect
 *
 * Body JSON:
 *   {
 *     institutionId: string,        // es. "INTESA_SANPAOLO_BCITITMM"
 *     redirectUrl?: string,         // default: GOCARDLESS_REDIRECT_URL
 *     userLanguage?: string,        // default: "IT"
 *     referenceId?: string          // UUID personale (rate limit / tracking)
 *   }
 *
 * Ritorna:
 *   { link, requisitionId, institutionId, redirectUrl }
 *
 * Il front-end deve redirigere l'utente su `link`. Dopo l'autorizzazione
 * bancaria, l'utente verrà riportato su `redirectUrl` (tipicamente
 * `/api/callback?ref=<requisitionId>`).
 */
export async function POST(request: Request) {
  if (!isGoCardlessConfigured()) {
    return NextResponse.json(
      {
        error:
          "GoCardless non è configurato. Imposta GOCARDLESS_SECRET_ID e GOCARDLESS_SECRET_KEY in .env.local.",
      },
      { status: 500 }
    );
  }

  let body: {
    institutionId?: string;
    redirectUrl?: string;
    userLanguage?: string;
    referenceId?: string;
  } = {};

  try {
    body = (await request.json()) ?? {};
  } catch {
    return NextResponse.json(
      { error: "Body JSON non valido" },
      { status: 400 }
    );
  }

  const institutionId = (body.institutionId ?? "").trim();
  if (!institutionId) {
    return NextResponse.json(
      { error: "institutionId è obbligatorio" },
      { status: 400 }
    );
  }

  const redirectUrl = body.redirectUrl?.trim() || getDefaultRedirectUrl();

  try {
    const session = await createConsentSession({
      institutionId,
      redirectUrl,
      referenceId: body.referenceId,
      userLanguage: body.userLanguage,
    });

    return NextResponse.json({
      ...session,
      redirectUrl,
    });
  } catch (error) {
    console.error("[/api/connect] Errore GoCardless", error);
    const message =
      error instanceof Error ? error.message : "Errore sconosciuto";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
