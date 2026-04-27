import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./supabase";

export type CronSyncCheckpointReason =
  | "complete"
  | "timeout"
  | "no_accounts"
  | "error";

export type CronSyncCheckpointPayload = {
  version: 1;
  lastRunAt: string;
  /** Millisecondi trascorsi lato server fino alla risposta. */
  durationMs: number;
  reason: CronSyncCheckpointReason;
  /** Errore di contesto (query account, sync singolo, ecc.) */
  errorMessage?: string;
  eligibleTotal: number;
  maxAccountsPerRun: number;
  /** Quanti account erano in coda in questo batch. */
  batchPlanned: number;
  /** Account per cui è stato eseguito almeno un tentativo di `syncTransactions` (ok o errore). */
  accountIdsCompleted: string[];
  /** In coda ma non avviati per budget tempo (stesso `batch` della run). */
  accountIdsSkippedByBudget: string[];
  /** Esito per account (stesso ordine del batch processato, parziale se timeout). */
  resultsSummary: Array<{
    accountId: string;
    accountName: string;
    userId: string;
    ok: boolean;
    error?: string;
  }>;
};

const SINGLETON_ID = "singleton" as const;

/**
 * Salva l’esito ultimo run cron (upsert su riga singleton).
 * Usa solo con `getSupabaseAdminClient()`.
 */
export async function writeCronSyncCheckpoint(
  admin: SupabaseClient<Database>,
  payload: CronSyncCheckpointPayload
): Promise<void> {
  const { error } = await admin.from("cron_sync_state").upsert(
    {
      id: SINGLETON_ID,
      updated_at: new Date().toISOString(),
      payload: { ...payload } as unknown as Json,
    },
    { onConflict: "id" }
  );
  if (error) {
    console.error("[cron_sync_state] upsert failed:", error.message);
  }
}
