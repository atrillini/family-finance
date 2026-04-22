import { NextResponse } from "next/server";
import { isGoCardlessConfigured } from "@/lib/gocardless";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase";
import { syncTransactions } from "@/lib/sync-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Limite massimo durata funzione (richiede piano Vercel che supporti valori alti). */
export const maxDuration = 300;

/**
 * Quanti account processare per esecuzione cron (evita timeout + rate limit).
 * Le altre righe eligible verranno coperte ai run successivi (priorità a chi synca meno).
 */
const DEFAULT_MAX_ACCOUNTS_PER_RUN = 8;

type CronAccountRow = {
  id: string;
  user_id: string | null;
  name: string;
  last_sync_at: string | null;
  requisition_id: string | null;
  gocardless_account_id: string | null;
};

function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

function parseMaxAccounts(): number {
  const raw = process.env.CRON_SYNC_MAX_ACCOUNTS_PER_RUN?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.min(n, 500);
  return DEFAULT_MAX_ACCOUNTS_PER_RUN;
}

function sortAccountsForCron(a: CronAccountRow, b: CronAccountRow): number {
  if (!a.last_sync_at && !b.last_sync_at) return 0;
  if (!a.last_sync_at) return -1;
  if (!b.last_sync_at) return 1;
  return (
    new Date(a.last_sync_at).getTime() - new Date(b.last_sync_at).getTime()
  );
}

async function runCron(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      {
        error:
          "CRON_SECRET non configurato. Imposta la variabile in Vercel → Environment Variables.",
      },
      { status: 500 }
    );
  }

  if (!isGoCardlessConfigured()) {
    return NextResponse.json(
      { error: "GoCardless non configurato." },
      { status: 500 }
    );
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      {
        error:
          "Serve SUPABASE_SERVICE_ROLE_KEY per il cron (sync senza sessione utente).",
      },
      { status: 500 }
    );
  }

  const maxAccounts = parseMaxAccounts();
  const admin = getSupabaseAdminClient();

  const { data: rows, error: qErr } = await admin
    .from("accounts")
    .select(
      "id, user_id, name, last_sync_at, requisition_id, gocardless_account_id"
    )
    .not("requisition_id", "is", null)
    .neq("requisition_id", "")
    .not("gocardless_account_id", "is", null)
    .neq("gocardless_account_id", "")
    .not("user_id", "is", null);

  if (qErr) {
    console.error("[cron/sync] query accounts:", qErr);
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  const eligible = (rows ?? []) as CronAccountRow[];
  eligible.sort(sortAccountsForCron);
  const batch = eligible.slice(0, maxAccounts);

  const results: Array<{
    accountId: string;
    accountName: string;
    userId: string;
    ok: boolean;
    report?: Awaited<ReturnType<typeof syncTransactions>>;
    error?: string;
  }> = [];

  for (const acc of batch) {
    const userId = acc.user_id as string;
    try {
      const report = await syncTransactions(acc.id, admin, userId);
      results.push({
        accountId: acc.id,
        accountName: acc.name,
        userId,
        ok: true,
        report,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[cron/sync] account ${acc.id}:`, message);
      results.push({
        accountId: acc.id,
        accountName: acc.name,
        userId,
        ok: false,
        error: message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: batch.length,
    eligibleTotal: eligible.length,
    truncated: eligible.length > maxAccounts,
    maxAccountsPerRun: maxAccounts,
    results,
  });
}

/** Vercel Cron invoca la route con GET. */
export async function GET(request: Request) {
  return runCron(request);
}

/** Utile per test manuali (curl POST) con lo stesso header Authorization. */
export async function POST(request: Request) {
  return runCron(request);
}
