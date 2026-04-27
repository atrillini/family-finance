import { NextResponse } from "next/server";

import {
  isAnyCronAuthConfigured,
  verifyCronRequest,
} from "@/lib/cron-auth";
import {
  type CronSyncCheckpointPayload,
  writeCronSyncCheckpoint,
} from "@/lib/cron-sync-checkpoint";
import { isGoCardlessConfigured } from "@/lib/gocardless";
import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase";
import { syncTransactions } from "@/lib/sync-transactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Limite d’esecuzione Vercel: resta sotto al timeout rete (504).
 * Il lavoro utile si ferma prima con `CRON_SYNC_BUDGET_MS` − riserva.
 */
export const maxDuration = 60;

/**
 * Quanti account processare per esecuzione cron (evita rate limit).
 * Le altre righe eligibili verranno coperte ai run successivi (ordinamento per
 * `last_sync_at` crescente: prima chi è più indietro).
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

function parseMaxAccounts(): number {
  const raw = process.env.CRON_SYNC_MAX_ACCOUNTS_PER_RUN?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.min(n, 500);
  return DEFAULT_MAX_ACCOUNTS_PER_RUN;
}

/**
 * Durata lavoro utile (sincro account) in ms. Default 50s meno una riserva per
 * risposta + scrittura checkpoint su Supabase, così Vercel non restituisce 504.
 */
function parseWorkBudgetMs(): { budgetMs: number; reserveMs: number; workMs: number } {
  const rawB = process.env.CRON_SYNC_BUDGET_MS?.trim();
  const budgetMs =
    Number.isFinite(Number(rawB)) && Number(rawB) >= 5_000
      ? Math.min(Number(rawB), 300_000)
      : 50_000;
  const rawR = process.env.CRON_SYNC_RESERVE_MS?.trim();
  const reserveMs =
    Number.isFinite(Number(rawR)) && Number(rawR) >= 0
      ? Math.min(Number(rawR), 20_000)
      : 2_000;
  const workMs = Math.max(3_000, budgetMs - reserveMs);
  return { budgetMs, reserveMs, workMs };
}

function sortAccountsForCron(a: CronAccountRow, b: CronAccountRow): number {
  if (!a.last_sync_at && !b.last_sync_at) return 0;
  if (!a.last_sync_at) return -1;
  if (!b.last_sync_at) return 1;
  return (
    new Date(a.last_sync_at).getTime() - new Date(b.last_sync_at).getTime()
  );
}

type OneResult = {
  accountId: string;
  accountName: string;
  userId: string;
  ok: boolean;
  report?: Awaited<ReturnType<typeof syncTransactions>>;
  error?: string;
};

async function runCron(request: Request) {
  if (!isAnyCronAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Configurare almeno CRON_SECRET (Vercel Cron) e/o CRON_EXTERNAL_KEY (cron esterno) in Vercel → Environment Variables.",
      },
      { status: 500 }
    );
  }

  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const { workMs, budgetMs, reserveMs } = parseWorkBudgetMs();
  const maxAccounts = parseMaxAccounts();
  const admin = getSupabaseAdminClient();
  const tAll = Date.now();

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

  const accountIdsCompleted: string[] = [];
  const results: OneResult[] = [];
  let stoppedByTimeout = false;

  if (batch.length === 0) {
    const payload: CronSyncCheckpointPayload = {
      version: 1,
      lastRunAt: new Date().toISOString(),
      durationMs: Date.now() - tAll,
      reason: "no_accounts",
      eligibleTotal: eligible.length,
      maxAccountsPerRun: maxAccounts,
      batchPlanned: 0,
      accountIdsCompleted: [],
      accountIdsSkippedByBudget: [],
      resultsSummary: [],
    };
    await writeCronSyncCheckpoint(admin, payload);
    return NextResponse.json({
      ok: true,
      processed: 0,
      eligibleTotal: eligible.length,
      truncated: false,
      maxAccountsPerRun: maxAccounts,
      workBudgetMs: workMs,
      wallBudgetMs: budgetMs,
      reserveMs,
      results,
      message: "Nessun conto con GoCardless da sincronizzare.",
    });
  }

  const t0 = Date.now();
  for (let i = 0; i < batch.length; i++) {
    if (Date.now() - t0 >= workMs) {
      stoppedByTimeout = true;
      break;
    }
    const acc = batch[i]!;
    const userId = acc.user_id as string;
    try {
      const report = await syncTransactions(acc.id, admin, userId);
      accountIdsCompleted.push(acc.id);
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
      accountIdsCompleted.push(acc.id);
      results.push({
        accountId: acc.id,
        accountName: acc.name,
        userId,
        ok: false,
        error: message,
      });
    }
  }

  const skipped = stoppedByTimeout
    ? batch.filter((a) => !accountIdsCompleted.includes(a.id))
    : [];
  const skippedIds = skipped.map((a) => a.id);
  const duration = Date.now() - tAll;

  const reason: CronSyncCheckpointPayload["reason"] = stoppedByTimeout
    ? "timeout"
    : "complete";

  await writeCronSyncCheckpoint(admin, {
    version: 1,
    lastRunAt: new Date().toISOString(),
    durationMs: duration,
    reason,
    eligibleTotal: eligible.length,
    maxAccountsPerRun: maxAccounts,
    batchPlanned: batch.length,
    accountIdsCompleted,
    accountIdsSkippedByBudget: skippedIds,
    resultsSummary: results.map((r) => ({
      accountId: r.accountId,
      accountName: r.accountName,
      userId: r.userId,
      ok: r.ok,
      error: r.error,
    })),
  });

  return NextResponse.json({
    ok: true,
    stoppedByTimeout,
    processed: results.length,
    skippedDueToTimeBudget: skipped.length,
    eligibleTotal: eligible.length,
    truncated: eligible.length > maxAccounts,
    maxAccountsPerRun: maxAccounts,
    workBudgetMs: workMs,
    wallBudgetMs: budgetMs,
    reserveMs,
    durationMs: duration,
    results,
  });
}

/** Vercel Cron o cron esterno: GET. */
export async function GET(request: Request) {
  return runCron(request);
}

/** Test manuale (es. curl POST) con gli stessi header. */
export async function POST(request: Request) {
  return runCron(request);
}
