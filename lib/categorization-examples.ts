import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionCategory } from "./gemini";
import type { CategorizationExampleRow, Database } from "./supabase";

export type { CategorizationExampleRow };

const DEFAULT_LIMIT = 25;
const DESC_PREVIEW = 280;
const MAX_DESCRIPTION_LEN = 600;
/** Massimo esempi tenuti per utente (i più vecchi vengono rimossi). */
const MAX_ROWS_PER_USER = 450;
/** Esempi più vecchi di questo vengono eliminati in prune. */
const MAX_AGE_DAYS = 120;

/**
 * Chiave stabile per la stessa “forma” di movimento (testo in estratto + merchant).
 * Non include le etichette: una nuova correzione sulla stessa riga sostituisce la precedente.
 */
export function categorizationExampleDedupeKey(
  payload: Pick<
    RecordCategorizationExamplePayload,
    "description" | "merchant"
  >
): string {
  const d = String(payload.description ?? "")
    .trim()
    .toLowerCase()
    .slice(0, MAX_DESCRIPTION_LEN);
  const m = String(payload.merchant ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 160);
  return createHash("sha256").update(`${d}\u001f${m}`).digest("hex");
}

/**
 * Carica gli ultimi esempi dell'utente (più recenti prima), da iniettare nel
 * prompt Gemini come few-shot analogo alle regole testuali.
 */
export async function loadCategorizationExamples(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit: number = DEFAULT_LIMIT
): Promise<CategorizationExampleRow[]> {
  const { data, error } = await supabase
    .from("categorization_examples")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 40));

  if (error) {
    console.warn(
      "[categorization-examples] impossibile caricare gli esempi:",
      error.message,
      "→ applica la migrazione SQL se non l'hai ancora fatta."
    );
    return [];
  }
  return (data ?? []) as CategorizationExampleRow[];
}

/**
 * Serializza gli esempi per il prompt (ordine preservato: il primo è il più recente).
 */
export function formatExamplesForPrompt(
  examples: CategorizationExampleRow[]
): string {
  if (!examples.length) return "";
  const lines = examples.map((e, i) => {
    const desc = String(e.description ?? "").slice(0, DESC_PREVIEW);
    const merch = (e.merchant ?? "").trim()
      ? ` | merchant: ${String(e.merchant).trim()}`
      : "";
    const tagsPart =
      Array.isArray(e.tags) && e.tags.length > 0
        ? ` | tags: ${e.tags.join(", ")}`
        : "";
    const subPart = e.is_subscription ? " | is_subscription: true" : "";
    const transferPart = e.is_transfer ? " | is_transfer: true" : "";
    return `${i + 1}. Descrizione: "${desc}"${merch} → category: ${e.category}${tagsPart}${subPart}${transferPart}`;
  });
  return lines.join("\n");
}

export type RecordCategorizationExamplePayload = {
  description: string;
  merchant: string | null;
  category: string;
  tags: string[];
  is_subscription: boolean;
  is_transfer: boolean;
};

function normalizePayload(
  payload: RecordCategorizationExamplePayload
): Omit<
  Database["public"]["Tables"]["categorization_examples"]["Insert"],
  "user_id"
> {
  const description = String(payload.description ?? "")
    .trim()
    .slice(0, MAX_DESCRIPTION_LEN);
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 16)
    : [];
  const merchant = payload.merchant?.trim()
    ? payload.merchant.trim().slice(0, 320)
    : null;
  const dedupe_key = categorizationExampleDedupeKey({
    description,
    merchant,
  });
  return {
    description,
    merchant,
    category: String(payload.category ?? "Altro").slice(
      0,
      64
    ) as TransactionCategory,
    tags,
    is_subscription: Boolean(payload.is_subscription),
    is_transfer: Boolean(payload.is_transfer),
    dedupe_key,
  };
}

/**
 * Elimina esempi troppo vecchi e, se necessario, i più vecchi oltre il tetto.
 */
export async function pruneCategorizationExamplesForUser(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<void> {
  const cutoff = new Date(
    Date.now() - MAX_AGE_DAYS * 86400000
  ).toISOString();

  const { error: oldErr } = await supabase
    .from("categorization_examples")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .lt("created_at", cutoff);

  if (oldErr) {
    console.warn("[categorization-examples] prune vecchi:", oldErr.message);
  }

  const { count, error: cntErr } = await supabase
    .from("categorization_examples")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (cntErr || count == null) return;

  const overflow = count - MAX_ROWS_PER_USER;
  if (overflow <= 0) return;

  const { data: oldest, error: selErr } = await supabase
    .from("categorization_examples")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(overflow);

  if (selErr || !oldest?.length) return;

  const ids = oldest.map((r) => r.id);
  const { error: delErr } = await supabase
    .from("categorization_examples")
    .delete()
    .in("id", ids);

  if (delErr) {
    console.warn("[categorization-examples] prune overflow:", delErr.message);
  }
}

/**
 * Persiste più esempi (bulk): per ogni dedupe_key si sostituisce la riga precedente.
 */
export async function recordCategorizationExamplesBatch(
  supabase: SupabaseClient<Database>,
  userId: string,
  payloads: RecordCategorizationExamplePayload[]
): Promise<void> {
  if (!payloads.length) return;

  const rows = payloads
    .map((p) => normalizePayload(p))
    .filter((r) => r.description.length > 0);

  if (!rows.length) return;

  const keys = [...new Set(rows.map((r) => r.dedupe_key))];

  const { error: delErr } = await supabase
    .from("categorization_examples")
    .delete()
    .eq("user_id", userId)
    .in("dedupe_key", keys);

  if (delErr) {
    console.warn(
      "[categorization-examples] delete dedupe fallito:",
      delErr.message
    );
    throw new Error(delErr.message);
  }

  const insertRows: Database["public"]["Tables"]["categorization_examples"]["Insert"][] =
    rows.map((r) => ({
      user_id: userId,
      ...r,
    }));

  const { error: insErr } = await supabase
    .from("categorization_examples")
    .insert(insertRows);

  if (insErr) {
    console.warn("[categorization-examples] insert batch:", insErr.message);
    throw new Error(insErr.message);
  }

  await pruneCategorizationExamplesForUser(supabase, userId);
}

/**
 * Persiste un singolo esempio dopo una correzione manuale confermata.
 */
export async function recordCategorizationExample(
  supabase: SupabaseClient<Database>,
  userId: string,
  payload: RecordCategorizationExamplePayload
): Promise<void> {
  await recordCategorizationExamplesBatch(supabase, userId, [payload]);
}
