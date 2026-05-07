import { NextResponse } from "next/server";
import { isGoCardlessConfigured, fetchAccountSnapshot } from "@/lib/gocardless";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getRouteSupabaseAndUser,
  unauthorizedJson,
} from "@/lib/supabase/route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function txDateKey(tx: Record<string, unknown>): string {
  const d =
    (typeof tx.bookingDateTime === "string" && tx.bookingDateTime) ||
    (typeof tx.bookingDate === "string" && tx.bookingDate) ||
    (typeof tx.valueDateTime === "string" && tx.valueDateTime) ||
    (typeof tx.valueDate === "string" && tx.valueDate) ||
    "";
  return d.slice(0, 10);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase non configurato." }, { status: 500 });
  }
  if (!isGoCardlessConfigured()) {
    return NextResponse.json({ error: "GoCardless non configurato." }, { status: 500 });
  }

  const auth = await getRouteSupabaseAndUser();
  if (!auth) return unauthorizedJson();

  const { id } = await context.params;
  const accountId = String(id ?? "").trim();
  if (!accountId) {
    return NextResponse.json({ error: "ID conto mancante." }, { status: 400 });
  }

  const { data: account, error } = await auth.supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", auth.user.id)
    .single();

  if (error || !account) {
    return NextResponse.json({ error: "Conto non trovato." }, { status: 404 });
  }
  if (!account.gocardless_account_id) {
    return NextResponse.json(
      { error: "Conto non collegato a GoCardless." },
      { status: 400 }
    );
  }

  try {
    const snap = await fetchAccountSnapshot(account.gocardless_account_id);
    const all = [...(snap.booked ?? []), ...(snap.pending ?? [])];
    const latestTxDate =
      all
        .map((t) => txDateKey(t as unknown as Record<string, unknown>))
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

    const balanceCandidates = (snap.balances ?? [])
      .map((b) => ({
        type: b.balanceType ?? "unknown",
        amount: Number(b.balanceAmount?.amount ?? NaN),
        referenceDate: b.referenceDate ?? null,
      }))
      .filter((x) => Number.isFinite(x.amount));

    return NextResponse.json({
      ok: true,
      debug: {
        accountId: account.id,
        accountName: account.name,
        gocardlessAccountId: account.gocardless_account_id,
        requisitionId: account.requisition_id,
        consentExpiresAt: account.consent_expires_at,
        lastSyncAtDb: account.last_sync_at,
        dbBalance: account.balance,
        bookedCount: snap.booked.length,
        pendingCount: snap.pending.length,
        latestTxDate,
        balanceCandidates,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore debug feed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

