import { NextResponse } from "next/server";
import { generateInvestmentScenarioNarrative } from "@/lib/gemini";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";

function fallbackText(): string {
  return (
    "Con i parametri indicati, i numeri mostrati sopra sono il risultato della simulazione **deterministica** dell’app (interessi composti mensili e versamenti fissi). " +
    "Non costituisce una previsione di mercato né consulenza finanziaria: i mercati reali sono imprevedibili e le tasse o i costi del prodotto non sono inclusi."
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase non configurato." },
      { status: 500 }
    );
  }

  if (!(await getRouteSupabaseAndUser())) return unauthorizedJson();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido." }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Payload non valido." }, { status: 400 });
  }

  const nums = [
    "startingPrincipal",
    "annualReturnPct",
    "monthlyContribution",
    "horizonYears",
    "endValue",
    "totalContributions",
    "marketComponent",
  ] as const;
  const parsed: Record<string, number> = {};
  for (const k of nums) {
    const n = Number(body[k]);
    if (!Number.isFinite(n)) {
      return NextResponse.json(
        { error: `Campo numerico mancante o non valido: ${k}` },
        { status: 400 }
      );
    }
    parsed[k] = n;
  }

  const includeLiquidityInPrincipal = body.includeLiquidityInPrincipal === true;

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json({
      narrative: fallbackText(),
      source: "fallback" as const,
    });
  }

  try {
    const narrative = await generateInvestmentScenarioNarrative({
      startingPrincipal: parsed.startingPrincipal,
      annualReturnPct: parsed.annualReturnPct,
      monthlyContribution: parsed.monthlyContribution,
      horizonYears: parsed.horizonYears,
      endValue: parsed.endValue,
      totalContributions: parsed.totalContributions,
      marketComponent: parsed.marketComponent,
      includeLiquidityInPrincipal,
    });
    return NextResponse.json({
      narrative: narrative || fallbackText(),
      source: "gemini" as const,
    });
  } catch {
    return NextResponse.json({
      narrative: fallbackText(),
      source: "fallback" as const,
    });
  }
}
