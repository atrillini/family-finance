import { NextResponse } from "next/server";
import {
  generateChartInsightFromAggregates,
  type ChartInsightPayload,
} from "@/lib/gemini";
import { fallbackInsightFromAggregates } from "@/lib/chart-insight-fallback";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function parsePayload(body: unknown): ChartInsightPayload | null {
  if (!isRecord(body)) return null;
  const periodCurrentLabel =
    typeof body.periodCurrentLabel === "string" ? body.periodCurrentLabel : "";
  const periodPreviousLabel =
    typeof body.periodPreviousLabel === "string" ? body.periodPreviousLabel : "";
  if (!periodCurrentLabel.trim() || !periodPreviousLabel.trim()) return null;

  const expenseCurrent = Number(body.expenseCurrent);
  const expensePrevious = Number(body.expensePrevious);
  if (!Number.isFinite(expenseCurrent) || !Number.isFinite(expensePrevious))
    return null;

  let expenseDeltaPct: number | null = null;
  if (body.expenseDeltaPct === null) expenseDeltaPct = null;
  else if (typeof body.expenseDeltaPct === "number" && Number.isFinite(body.expenseDeltaPct)) {
    expenseDeltaPct = body.expenseDeltaPct;
  }

  const rawTop = Array.isArray(body.topTagsCurrent) ? body.topTagsCurrent : [];
  const topTagsCurrent = rawTop
    .filter(isRecord)
    .map((r) => ({
      tag: typeof r.tag === "string" ? r.tag : "(sconosciuto)",
      amount: Number(r.amount),
      sharePct: Number(r.sharePct),
    }))
    .filter((r) => Number.isFinite(r.amount) && Number.isFinite(r.sharePct));

  let weeklyBurn: ChartInsightPayload["weeklyBurn"];
  if (isRecord(body.weeklyBurn)) {
    const w = body.weeklyBurn;
    const weekLabel = typeof w.weekLabel === "string" ? w.weekLabel : "";
    const spendCumulativeEnd = Number(w.spendCumulativeEnd);
    const avgPreviousWeeksCumulativeEnd = Number(w.avgPreviousWeeksCumulativeEnd);
    if (
      weekLabel.trim() &&
      Number.isFinite(spendCumulativeEnd) &&
      Number.isFinite(avgPreviousWeeksCumulativeEnd)
    ) {
      weeklyBurn = {
        weekLabel: weekLabel.trim(),
        spendCumulativeEnd,
        avgPreviousWeeksCumulativeEnd,
      };
    }
  }

  return {
    periodCurrentLabel: periodCurrentLabel.trim(),
    periodPreviousLabel: periodPreviousLabel.trim(),
    expenseCurrent,
    expensePrevious,
    expenseDeltaPct,
    topTagsCurrent,
    ...(weeklyBurn ? { weeklyBurn } : {}),
  };
}

/**
 * POST /api/chart-insight
 * Body: ChartInsightPayload (JSON con soli aggregati).
 * Risposta: { insight: string, source: "gemini" | "fallback" }
 */
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

  const payload = parsePayload(body);
  if (!payload) {
    return NextResponse.json(
      { error: "Payload insight non valido o incompleto." },
      { status: 400 }
    );
  }

  const hasKey = Boolean(process.env.GEMINI_API_KEY?.trim());
  if (!hasKey) {
    return NextResponse.json({
      insight: fallbackInsightFromAggregates(payload),
      source: "fallback" as const,
    });
  }

  try {
    const insight = await generateChartInsightFromAggregates(payload);
    if (!insight) {
      return NextResponse.json({
        insight: fallbackInsightFromAggregates(payload),
        source: "fallback" as const,
      });
    }
    return NextResponse.json({ insight, source: "gemini" as const });
  } catch {
    return NextResponse.json({
      insight: fallbackInsightFromAggregates(payload),
      source: "fallback" as const,
    });
  }
}
