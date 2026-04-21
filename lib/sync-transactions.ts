import "server-only";

import { createHash } from "node:crypto";
import {
  fetchAccountSnapshot,
  type GoCardlessTransaction,
} from "./gocardless";
import { analyzeTransaction, type TransactionAnalysis } from "./gemini";
import { getSupabaseAdminClient } from "./supabase";
import type { AccountRow, Database, TransactionRow } from "./supabase";
import {
  applyRules,
  formatRulesForPrompt,
  loadCategorizationRules,
} from "./categorization-rules";
import { getSyncFloorDate, isAtOrAfterFloor } from "./sync-floor";

type TransactionInsert =
  Database["public"]["Tables"]["transactions"]["Insert"];

export type SyncReport = {
  accountId: string;
  accountName: string;
  fetched: number;
  inserted: number;
  skipped: number;
  /**
   * Numero di transazioni che al momento dell'insert hanno avuto una
   * categoria vera (diversa da "Altro" con tag vuoti). Utile per capire,
   * osservando i log di sync, quanto bene Gemini ha lavorato sul batch.
   */
  categorized: number;
  balance: number | null;
  lastSyncAt: string;
};

/**
 * Massimo numero di chiamate Gemini parallele eseguite durante un sync.
 *
 * Nota: il tier free di Gemini è ~15 RPM; se lanciamo 60 richieste in
 * parallelo tutte assieme finiamo immediatamente in 429 e, con la vecchia
 * versione di `safeAnalyze`, tutte le transazioni finivano silenziosamente
 * categorizzate come "Altro" senza tag. Limitando a 3-4 la concorrenza
 * sotto 15 RPM ci teniamo dentro la quota e aumentiamo drasticamente la
 * percentuale di transazioni categorizzate davvero dall'IA.
 */
const AI_CONCURRENCY = Number(process.env.SYNC_AI_CONCURRENCY || 3);

/**
 * Sincronizza le transazioni di un account collegato a GoCardless.
 *
 * - Recupera transazioni (booked + pending) dall'API GoCardless
 * - Filtra quelle già presenti su Supabase (per `external_id` + `account_id`)
 * - Usa Gemini per categorizzare automaticamente le nuove
 * - Fa un upsert su `transactions` usando `(account_id, external_id)` come chiave
 * - Aggiorna `balance` e `last_sync_at` sull'account
 *
 * Requisiti: `.env.local` con le variabili GoCardless + `SUPABASE_SERVICE_ROLE_KEY`.
 */
export async function syncTransactions(
  accountId: string
): Promise<SyncReport> {
  const supabase = getSupabaseAdminClient();

  const { data: account, error: accErr } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (accErr || !account) {
    throw new Error(
      `Account ${accountId} non trovato su Supabase: ${accErr?.message ?? "record assente"}`
    );
  }

  if (!account.gocardless_account_id) {
    throw new Error(
      `L'account "${account.name}" non è collegato a GoCardless (manca gocardless_account_id).`
    );
  }

  // Limitiamo la richiesta al floor (SYNC_MIN_DATE): non scarichiamo
  // transazioni più vecchie perché tanto le scarteremmo subito dopo.
  // Risparmia banda, rate-limit GoCardless e soprattutto chiamate a Gemini.
  const floorDate = getSyncFloorDate();
  const snapshot = await fetchAccountSnapshot(account.gocardless_account_id, {
    dateFrom: floorDate,
  });

  const bookedWithFlag = snapshot.booked.map((t) => ({ tx: t, pending: false }));
  const pendingWithFlag = snapshot.pending.map((t) => ({
    tx: t,
    pending: true,
  }));
  const all = [...bookedWithFlag, ...pendingWithFlag];

  const normalizedAll = all
    .map((item) => normalizeTransaction(item.tx, item.pending, account.id))
    .filter((t): t is NormalizedTransaction => Boolean(t));

  // Filtro difensivo: alcune banche ignorano `dateFrom` e ritornano comunque
  // storici più ampi. Qui teniamo solo ciò che è >= floor.
  const beforeFloorCount = normalizedAll.length;
  const normalizedInRange = normalizedAll.filter((t) =>
    isAtOrAfterFloor(t.date)
  );
  const droppedByFloor = beforeFloorCount - normalizedInRange.length;
  if (droppedByFloor > 0) {
    console.info(
      "[sync] scartate",
      droppedByFloor,
      "transazioni antecedenti il floor",
      floorDate
    );
  }

  // Deduplica lato client: la stessa transazione può apparire sia in booked
  // sia in pending, oppure GoCardless può restituire la medesima riga due
  // volte con lo stesso `internalTransactionId`.
  const byKey = new Map<string, NormalizedTransaction>();
  for (const t of normalizedInRange) {
    if (!byKey.has(t.external_id)) byKey.set(t.external_id, t);
  }
  const normalized = Array.from(byKey.values());

  const externalIds = normalized.map((t) => t.external_id);
  const { data: existing, error: existingErr } = await supabase
    .from("transactions")
    .select("external_id")
    .eq("account_id", account.id)
    .in("external_id", externalIds.length > 0 ? externalIds : ["__none__"]);

  if (existingErr) {
    throw new Error(
      `Errore nel leggere le transazioni esistenti: ${existingErr.message}`
    );
  }

  const known = new Set(
    (existing ?? [])
      .map((r) => r.external_id)
      .filter((v): v is string => Boolean(v))
  );
  const toInsert = normalized.filter((t) => !known.has(t.external_id));

  // Carichiamo una sola volta le regole utente e prepariamo il blocco di
  // prompt da passare a Gemini: in questo modo anche quando la regola non
  // matcha esattamente l'IA "vede" gli schemi che l'utente vuole rispettare.
  const rules = await loadCategorizationRules();
  const rulesBlock = formatRulesForPrompt(rules);

  // Statistiche per capire quanto ha pesato Gemini su questo batch.
  let aiOk = 0;
  let aiFailed = 0;
  let ruleHits = 0;

  const categorized = await mapWithConcurrency(
    toInsert,
    AI_CONCURRENCY,
    async (t) => {
      // 1) Match rapido con una regola utente: se matcha, saltiamo Gemini.
      const ruleMatch = applyRules(rules, t.description, t.merchantFallback);
      if (ruleMatch) {
        ruleHits++;
        const row: TransactionInsert = {
          description: t.description,
          merchant: ruleMatch.merchant || t.merchantFallback || t.description,
          category: ruleMatch.category,
          amount: t.amount,
          tags: ruleMatch.tags,
          is_subscription: ruleMatch.is_subscription,
          is_transfer: ruleMatch.is_transfer,
          account_id: account.id,
          external_id: t.external_id,
          date: t.date,
        };
        return row;
      }

      // 2) Nessuna regola → chiediamo a Gemini (passando le regole come
      //    contesto "educativo").
      const aiInput = buildAiDescription({
        remittance: t.remittance,
        counterparty: t.merchantFallback,
        fallback: t.description,
        hints: t.aiHints,
      });
      const { analysis, ok } = await safeAnalyze(aiInput, rulesBlock);
      if (ok) aiOk++;
      else aiFailed++;
      const row: TransactionInsert = {
        description: t.description,
        merchant: analysis.merchant || t.merchantFallback || t.description,
        category: analysis.category,
        amount: t.amount,
        tags: analysis.tags,
        is_subscription: analysis.is_subscription,
        account_id: account.id,
        external_id: t.external_id,
        date: t.date,
      };
      return row;
    }
  );

  if (toInsert.length > 0) {
    console.info(
      "[sync] categorization:",
      ruleHits,
      "via regole utente,",
      aiOk,
      "via Gemini /",
      toInsert.length,
      "(",
      aiFailed,
      "fallback su 'Altro')"
    );
  }

  // Inseriamo le nuove transazioni. NON usiamo `upsert(...).onConflict` perché
  // richiederebbe un UNIQUE CONSTRAINT (o indice unique non-parziale) su
  // `(account_id, external_id)`; qui ci basiamo sul pre-check appena fatto
  // (`known`) per evitare duplicati. Se un domani aggiungi il constraint
  // (vedi migrazione in `lib/supabase.ts`) potrai tornare all'upsert
  // nativo per coprire anche le race-condition di più sync in parallelo.
  let insertedCount = 0;
  if (categorized.length > 0) {
    const { error: insertErr, count, data } = await supabase
      .from("transactions")
      .insert(categorized, { count: "exact" })
      .select("id");

    if (insertErr) {
      // Se per qualche motivo il constraint unique esiste ed è scattato,
      // consideriamo i duplicati come "gia' presenti" e non come fallimento.
      const msg = insertErr.message || "";
      if (
        msg.includes("duplicate key") ||
        msg.includes("23505") ||
        (insertErr as { code?: string }).code === "23505"
      ) {
        console.warn(
          "[sync] insert ha incontrato duplicate key, ignoro:",
          msg
        );
      } else {
        throw new Error(
          `Errore nell'insert delle transazioni: ${insertErr.message}`
        );
      }
    }
    insertedCount = count ?? data?.length ?? 0;
  }

  const balance = pickBalance(snapshot.balances);
  const lastSyncAt = new Date().toISOString();

  const update: Database["public"]["Tables"]["accounts"]["Update"] = {
    last_sync_at: lastSyncAt,
  };
  if (balance !== null) update.balance = balance;
  if (!account.iban && snapshot.details?.account?.iban) {
    update.iban = snapshot.details.account.iban;
  }

  await supabase.from("accounts").update(update).eq("id", account.id);

  return {
    accountId: account.id,
    accountName: account.name,
    fetched: normalized.length,
    inserted: insertedCount,
    skipped: normalized.length - categorized.length,
    categorized: aiOk,
    balance,
    lastSyncAt,
  };
}

export type RefreshDescriptionsReport = {
  accountId: string;
  accountName: string;
  /** Transazioni ri-scaricate dalla banca e allineate al floor date. */
  fetched: number;
  /** Transazioni trovate in DB (match per `external_id`). */
  matched: number;
  /** Quante hanno avuto `description` o `merchant` effettivamente cambiati. */
  updated: number;
  /** Quante, dopo l'update, sono state anche ricategorizzate con Gemini. */
  recategorized: number;
  /** Quante il ri-scarico ha trovato sulla banca ma che NON esistono in DB
   *  (es. cancellate, mai sincronizzate): le ignoriamo qui, sono competenza
   *  di `syncTransactions`. */
  missing: number;
};

/**
 * Ri-scarica le transazioni dalla banca via GoCardless e aggiorna le righe
 * già esistenti in DB SOLO sui campi "di provenienza bancaria":
 *
 *   - `description` → il testo leggibile normalizzato (con il nuovo parser
 *      che legge anche array structured + additionalInformation + …);
 *   - `merchant`    → counterparty (creditorName / ultimateCreditor / …).
 *
 * NON viene mai toccato quello che l'utente o l'IA hanno curato:
 * `category`, `tags`, `is_subscription`, `is_transfer`, `notes`, `amount`,
 * `date`, `account_id` restano identici.
 *
 * Opzioni:
 *   - `recategorizeAltro`: dopo aver aggiornato la descrizione, per le
 *      transazioni ancora in categoria "Altro" con `tags` vuoti rilancia
 *      `analyzeTransaction` con il nuovo testo. Così riassorbi il grosso
 *      delle perdite iniziali senza sprecare quota IA sulle transazioni
 *      già ben categorizzate.
 *   - `onlyIds`: limita il lavoro a specifici `transactions.id`. Utile
 *      per un eventuale refresh "a selezione" dalla UI.
 */
export async function refreshDescriptions(
  accountId: string,
  options: {
    recategorizeAltro?: boolean;
    onlyIds?: string[];
  } = {}
): Promise<RefreshDescriptionsReport> {
  const { recategorizeAltro = false, onlyIds } = options;
  const supabase = getSupabaseAdminClient();

  const { data: account, error: accErr } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (accErr || !account) {
    throw new Error(
      `Account ${accountId} non trovato su Supabase: ${accErr?.message ?? "record assente"}`
    );
  }

  if (!account.gocardless_account_id) {
    throw new Error(
      `L'account "${account.name}" non è collegato a GoCardless (manca gocardless_account_id).`
    );
  }

  // 1) Ri-scarichiamo dalla banca, rispettando sempre il floor date.
  const floorDate = getSyncFloorDate();
  const snapshot = await fetchAccountSnapshot(account.gocardless_account_id, {
    dateFrom: floorDate,
  });

  const bookedWithFlag = snapshot.booked.map((t) => ({ tx: t, pending: false }));
  const pendingWithFlag = snapshot.pending.map((t) => ({
    tx: t,
    pending: true,
  }));
  const all = [...bookedWithFlag, ...pendingWithFlag];

  const normalizedAll = all
    .map((item) => normalizeTransaction(item.tx, item.pending, account.id))
    .filter((t): t is NormalizedTransaction => Boolean(t));
  const normalizedInRange = normalizedAll.filter((t) =>
    isAtOrAfterFloor(t.date)
  );

  // Dedup client-side: la stessa external_id può arrivare da booked e pending.
  const bankByExtId = new Map<string, NormalizedTransaction>();
  for (const t of normalizedInRange) {
    if (!bankByExtId.has(t.external_id)) bankByExtId.set(t.external_id, t);
  }

  // 2) Leggiamo le righe esistenti dell'account (con filtro opzionale per ids).
  let existingQuery = supabase
    .from("transactions")
    .select("*")
    .eq("account_id", account.id);
  if (onlyIds && onlyIds.length > 0) {
    existingQuery = existingQuery.in("id", onlyIds);
  }
  const { data: existing, error: existingErr } = await existingQuery;
  if (existingErr) {
    throw new Error(
      `Errore nel leggere le transazioni esistenti: ${existingErr.message}`
    );
  }
  const rows = (existing ?? []).filter(
    (r): r is TransactionRow & { external_id: string } => Boolean(r.external_id)
  );

  // Indicizziamo per external_id per fare match O(1) con la banca.
  const rowsByExtId = new Map<string, (typeof rows)[number]>();
  for (const r of rows) rowsByExtId.set(r.external_id, r);

  // 3) Preparo gli update mirati.
  type UpdatePlan = {
    id: string;
    patch: Database["public"]["Tables"]["transactions"]["Update"];
    normalized: NormalizedTransaction;
    row: (typeof rows)[number];
  };
  const plans: UpdatePlan[] = [];

  for (const [extId, n] of bankByExtId) {
    const row = rowsByExtId.get(extId);
    if (!row) continue;

    const patch: Database["public"]["Tables"]["transactions"]["Update"] = {};

    // description: aggiorniamo se è cambiata davvero (case-sensitive trim).
    const newDesc = (n.description ?? "").trim();
    if (newDesc && newDesc !== (row.description ?? "").trim()) {
      patch.description = newDesc;
    }

    // merchant: aggiorniamo solo se prima era vuoto o uguale alla descrizione
    // (= fallback). Se l'utente l'ha scritto a mano NON lo sovrascriviamo.
    const oldMerchant = (row.merchant ?? "").trim();
    const looksLikeFallback =
      !oldMerchant || oldMerchant === (row.description ?? "").trim();
    const newMerchant = n.merchantFallback?.trim() ?? "";
    if (looksLikeFallback && newMerchant && newMerchant !== oldMerchant) {
      patch.merchant = newMerchant;
    }

    if (Object.keys(patch).length > 0) {
      plans.push({ id: row.id, patch, normalized: n, row });
    }
  }

  // 4) Applichiamo gli update (in batch per non esplodere su account grandi).
  let updatedCount = 0;
  for (const p of plans) {
    const { error: updErr, count } = await supabase
      .from("transactions")
      .update(p.patch, { count: "exact" })
      .eq("id", p.id);
    if (updErr) {
      console.warn("[refresh-descriptions] update fallito", {
        id: p.id,
        error: updErr.message,
      });
      continue;
    }
    if ((count ?? 0) > 0) updatedCount++;
  }

  // 5) Eventualmente rilanciamo la categorizzazione IA SOLO sulle righe che
  //    sono rimaste "Altro" senza tag: l'update descrizione ha probabilmente
  //    migliorato il contesto e ora Gemini dovrebbe riuscire a classificarle.
  let recategorizedCount = 0;
  if (recategorizeAltro && plans.length > 0) {
    // Carichiamo regole + rules-block una volta sola.
    const userRules = await loadCategorizationRules();
    const rulesBlock = formatRulesForPrompt(userRules);

    const toRecategorize = plans.filter(({ row }) => {
      const cat = (row.category ?? "").trim();
      const hasTags = Array.isArray(row.tags) && row.tags.length > 0;
      return cat === "Altro" && !hasTags;
    });

    await mapWithConcurrency(
      toRecategorize,
      AI_CONCURRENCY,
      async ({ id, normalized, row }) => {
        // Prima tentiamo una regola utente sul testo NUOVO: se matcha,
        // evitiamo del tutto Gemini.
        const ruleMatch = applyRules(
          userRules,
          normalized.description,
          normalized.merchantFallback
        );
        if (ruleMatch) {
          const patch: Database["public"]["Tables"]["transactions"]["Update"] = {
            category: ruleMatch.category,
            tags: ruleMatch.tags,
            is_subscription: ruleMatch.is_subscription,
            is_transfer: ruleMatch.is_transfer,
            merchant: ruleMatch.merchant || row.merchant || null,
          };
          const { error: uErr, count } = await supabase
            .from("transactions")
            .update(patch, { count: "exact" })
            .eq("id", id);
          if (!uErr && (count ?? 0) > 0) recategorizedCount++;
          return;
        }

        const aiInput = buildAiDescription({
          remittance: normalized.remittance,
          counterparty: normalized.merchantFallback,
          fallback: normalized.description,
          hints: normalized.aiHints,
        });
        const { analysis, ok } = await safeAnalyze(aiInput, rulesBlock);
        if (!ok) return;

        const patch: Database["public"]["Tables"]["transactions"]["Update"] = {
          category: analysis.category,
          tags: analysis.tags,
          is_subscription: analysis.is_subscription,
          merchant: analysis.merchant || row.merchant || null,
        };
        const { error: uErr, count } = await supabase
          .from("transactions")
          .update(patch, { count: "exact" })
          .eq("id", id);
        if (!uErr && (count ?? 0) > 0) recategorizedCount++;
      }
    );
  }

  // 6) Missing = sulla banca ci sono transazioni (post-floor) che in DB non
  //    troviamo. Non è un errore: ce le porta `syncTransactions`. La
  //    esponiamo solo a titolo informativo.
  let missing = 0;
  for (const extId of bankByExtId.keys()) {
    if (!rowsByExtId.has(extId)) missing++;
  }

  console.info("[refresh-descriptions] done", {
    account: account.name,
    fetched: bankByExtId.size,
    matched: plans.length + /* plans esclude no-op */ 0,
    updated: updatedCount,
    recategorized: recategorizedCount,
    missing,
  });

  return {
    accountId: account.id,
    accountName: account.name,
    fetched: bankByExtId.size,
    matched: Array.from(bankByExtId.keys()).filter((extId) =>
      rowsByExtId.has(extId)
    ).length,
    updated: updatedCount,
    recategorized: recategorizedCount,
    missing,
  };
}

/**
 * Ricategorizza una singola transazione già presente in DB usando Gemini.
 * Richiamata da `/api/recategorize` quando l'utente clicca il pulsante
 * "Ricategorizza con IA" accanto a una riga.
 *
 * Aggiorna `category`, `merchant`, `tags`, `is_subscription`. Non tocca
 * `amount`/`date`/`account_id` (quelli sono verità bancaria).
 */
export async function recategorizeTransaction(
  transactionId: string
): Promise<TransactionRow> {
  const supabase = getSupabaseAdminClient();

  const { data: tx, error: readErr } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .single();

  if (readErr || !tx) {
    throw new Error(
      `Transazione ${transactionId} non trovata: ${readErr?.message ?? "record assente"}`
    );
  }

  const aiInput = buildAiDescription({
    remittance: tx.description,
    counterparty: tx.merchant,
    fallback: tx.description,
  });

  // Prima di chiamare Gemini vediamo se una regola utente risolve da sola
  // la categorizzazione: se sì evitiamo la chiamata AI, è più veloce e
  // soprattutto più "obbediente" a quello che l'utente ha già istruito.
  const rules = await loadCategorizationRules();
  const ruleMatch = applyRules(rules, tx.description, tx.merchant);

  const update: Database["public"]["Tables"]["transactions"]["Update"] = {};

  if (ruleMatch) {
    update.category = ruleMatch.category;
    update.tags = ruleMatch.tags;
    update.is_subscription = ruleMatch.is_subscription;
    update.is_transfer = ruleMatch.is_transfer;
    update.merchant = ruleMatch.merchant || tx.merchant || null;
    console.info("[recategorize] regola utente ha matchato", {
      id: transactionId,
      ruleId: ruleMatch.matchedRuleId,
      category: ruleMatch.category,
    });
  } else {
    // Qui vogliamo l'errore "grezzo" perché stiamo rispondendo a un'azione
    // diretta dell'utente: se Gemini sta ritornando 429 o la API key non è
    // valida preferiamo esporre il motivo invece di silenziare tutto con un
    // fallback "Altro".
    const analysis = await analyzeTransaction(aiInput, {
      userRulesBlock: formatRulesForPrompt(rules),
    });
    update.category = analysis.category;
    update.tags = analysis.tags;
    update.is_subscription = analysis.is_subscription;
    // Preserviamo il merchant precedente se l'IA non ha trovato nulla di
    // meglio — importante soprattutto quando la transazione era stata creata
    // a mano con un merchant già "pulito" dall'utente.
    update.merchant = analysis.merchant || tx.merchant || null;
  }

  const { data: updated, error: updateErr } = await supabase
    .from("transactions")
    .update(update, { count: "exact" })
    .eq("id", transactionId)
    .select("*")
    .single();

  if (updateErr || !updated) {
    throw new Error(
      `Impossibile aggiornare la transazione ${transactionId}: ${updateErr?.message}`
    );
  }

  console.info("[recategorize] ok", {
    id: updated.id,
    category: updated.category,
    tags: updated.tags,
    is_subscription: updated.is_subscription,
  });

  return updated;
}

/**
 * Esegue un `fn` su ogni elemento rispettando un limite di concorrenza.
 * Evita `Promise.all` su array lunghi quando `fn` chiama API con rate-limit
 * (Gemini: 15 RPM in free tier).
 */
async function mapWithConcurrency<T, U>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  if (items.length === 0) return results;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers: Promise<void>[] = [];
  const poolSize = Math.max(1, Math.min(limit, items.length));
  for (let i = 0; i < poolSize; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/**
 * Crea (o aggiorna) un record `accounts` a partire dagli ID GoCardless
 * ottenuti dopo il callback di consenso. Viene eseguito dentro `/api/callback`.
 */
export async function upsertAccountFromRequisition(params: {
  gocardlessAccountId: string;
  requisitionId: string;
  institutionId: string;
  institutionName?: string | null;
  institutionLogo?: string | null;
}): Promise<AccountRow> {
  const supabase = getSupabaseAdminClient();

  const { data: existing, error: existingErr } = await supabase
    .from("accounts")
    .select("*")
    .eq("gocardless_account_id", params.gocardlessAccountId)
    .maybeSingle();

  if (existingErr) {
    console.error(
      "[sync/upsertAccount] errore lettura account esistente",
      existingErr
    );
  }

  let details: Awaited<ReturnType<typeof fetchAccountSnapshot>>["details"] = {};
  let balances: Awaited<ReturnType<typeof fetchAccountSnapshot>>["balances"] =
    [];
  try {
    const snap = await fetchAccountSnapshot(params.gocardlessAccountId);
    details = snap.details;
    balances = snap.balances;
  } catch {
    // ignora: details/balances possono non essere pronti subito dopo il consenso
  }

  const balance = pickBalance(balances);
  const iban = details?.account?.iban ?? null;
  const ownerName =
    details?.account?.name ||
    details?.account?.ownerName ||
    params.institutionName ||
    "Conto collegato";

  if (existing) {
    const update: Database["public"]["Tables"]["accounts"]["Update"] = {
      requisition_id: params.requisitionId,
      institution_id: params.institutionId,
      gocardless_account_id: params.gocardlessAccountId,
    };
    if (balance !== null) update.balance = balance;
    if (iban) update.iban = iban;
    if (params.institutionLogo && !existing.logo_url) {
      update.logo_url = params.institutionLogo;
    }

    const { data, error } = await supabase
      .from("accounts")
      .update(update)
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error || !data) {
      console.error("[sync/upsertAccount] update failed", error);
      throw new Error(
        `Impossibile aggiornare l'account ${existing.id}: ${error?.message}`
      );
    }
    console.info("[sync/upsertAccount] update ok", {
      id: data.id,
      name: data.name,
    });
    return data;
  }

  const { data, error } = await supabase
    .from("accounts")
    .insert({
      name: ownerName,
      type: "conto corrente",
      balance: balance ?? 0,
      logo_url: params.institutionLogo ?? null,
      iban,
      institution_id: params.institutionId,
      requisition_id: params.requisitionId,
      gocardless_account_id: params.gocardlessAccountId,
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("[sync/upsertAccount] insert failed", error);
    throw new Error(
      `Impossibile creare l'account per ${params.gocardlessAccountId}: ${error?.message}`
    );
  }
  console.info("[sync/upsertAccount] insert ok", {
    id: data.id,
    name: data.name,
    gocardless_account_id: data.gocardless_account_id,
  });
  return data;
}

type NormalizedTransaction = {
  external_id: string;
  description: string;
  remittance: string;
  merchantFallback: string | null;
  amount: number;
  date: string;
  /**
   * Indizi aggiuntivi (codici banca, MCC, purposeCode, IBAN controparte):
   * da soli non sono leggibili per l'utente ma — uniti alla descrizione —
   * aiutano Gemini a capire il tipo di spesa. Vengono passati nel prompt
   * di `analyzeTransaction` tramite `buildAiDescription`.
   */
  aiHints?: string[];
};

/**
 * Etichette generiche che le banche italiane usano come "titolo tipo"
 * dell'operazione. Da sole non dicono nulla di utile per la categorizzazione
 * (tutto "Pagamenti paesi UE" → tutto "Altro"). Se la nostra remittance
 * finale si riduce a una di queste, consideriamo la descrizione "povera"
 * e logghiamo la transazione grezza per diagnosi.
 */
const GENERIC_BANK_LABELS = new Set(
  [
    "pagamenti paesi ue",
    "pagamenti paesi extra ue",
    "pagamento pos",
    "pagamento pos estero",
    "addebito diretto",
    "addebito sdd",
    "bonifico ricevuto",
    "bonifico a vostro favore",
    "bonifico estero",
    "acquisto pos",
    "prelievo bancomat",
    "commissioni",
    "spese",
    "storno",
    "disposizione",
    "operazione",
    "movimento",
    "pagamento",
    "acquisto",
  ].map((s) => s.toLowerCase())
);

function isGenericBankLabel(s: string): boolean {
  const k = s.trim().toLowerCase();
  if (!k) return true;
  if (k.length <= 3) return true;
  return GENERIC_BANK_LABELS.has(k);
}

/**
 * Raccoglie TUTTE le stringhe descrittive disponibili dalla transazione
 * Berlin Group. Banche diverse popolano campi diversi: Mediolanum per
 * esempio usa `remittanceInformationUnstructuredArray` come contenitore
 * principale del dettaglio mentre `remittanceInformationUnstructured`
 * tiene solo l'etichetta "Pagamenti paesi UE". Se guardassimo solo
 * `Unstructured` perderemmo il 90% dei dati leggibili.
 */
function collectRemittanceSources(tx: GoCardlessTransaction): string[] {
  const sources: string[] = [];

  if (tx.remittanceInformationUnstructured) {
    sources.push(tx.remittanceInformationUnstructured);
  }
  if (Array.isArray(tx.remittanceInformationUnstructuredArray)) {
    for (const line of tx.remittanceInformationUnstructuredArray) {
      if (typeof line === "string" && line.trim()) sources.push(line);
    }
  }
  if (tx.remittanceInformationStructured) {
    sources.push(tx.remittanceInformationStructured);
  }
  if (Array.isArray(tx.remittanceInformationStructuredArray)) {
    for (const line of tx.remittanceInformationStructuredArray) {
      if (typeof line === "string" && line.trim()) sources.push(line);
    }
  }
  if (tx.additionalInformation) {
    sources.push(tx.additionalInformation);
  }
  if (tx.additionalInformationStructured) {
    for (const v of Object.values(tx.additionalInformationStructured)) {
      if (typeof v === "string" && v.trim()) sources.push(v);
    }
  }

  return sources;
}

function normalizeTransaction(
  tx: GoCardlessTransaction,
  isPending: boolean,
  accountId: string
): NormalizedTransaction | null {
  const amountRaw = tx.transactionAmount?.amount;
  if (!amountRaw) return null;
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount)) return null;

  const date =
    tx.bookingDateTime ||
    tx.bookingDate ||
    tx.valueDate ||
    tx.valueDateTime ||
    new Date().toISOString();

  // 1) Aggreghiamo TUTTE le fonti testuali disponibili, separandole con
  //    " · " (che cleanRemittance poi ripulisce). In questo modo anche
  //    le banche che usano gli array multi-riga (Mediolanum) o i campi
  //    "structured" / "additionalInformation" finiscono nel prompt di
  //    Gemini con tutto il contesto che hanno reso disponibile.
  const sources = collectRemittanceSources(tx);
  const rawRemittance = sources.join(" · ");
  const remittance = cleanRemittance(rawRemittance);

  // 2) Se ciò che resta dopo il cleanup è una singola etichetta generica
  //    tipo "Pagamenti paesi UE", scartiamola e ricadiamo sui nomi di
  //    controparte: molto meglio avere "AMAZON EU SARL" (che l'IA
  //    riconosce) piuttosto che una categoria-ombrello della banca.
  const remittanceIsGeneric = isGenericBankLabel(remittance);

  const creditor = tx.creditorName?.trim() || "";
  const debtor = tx.debtorName?.trim() || "";
  const ultimateCreditor = tx.ultimateCreditor?.trim() || "";
  const ultimateDebtor = tx.ultimateDebtor?.trim() || "";
  const counterpartyName =
    creditor || ultimateCreditor || debtor || ultimateDebtor || "";

  // 3) Descrizione finale: remittance "ricca" > nome controparte >
  //    remittance grezza (anche se generica: meglio di nulla) > default.
  const description =
    (!remittanceIsGeneric && remittance) ||
    counterpartyName ||
    remittance ||
    rawRemittance.trim() ||
    "Transazione";

  const merchantFallback = counterpartyName || null;

  // Dedup: preferiamo `internalTransactionId` (sempre valorizzato dalla banca)
  // come suggerito dalla documentazione GoCardless, fallback a
  // `transactionId` e, infine, a un hash stabile dei campi chiave.
  const externalId =
    tx.internalTransactionId ||
    tx.transactionId ||
    buildFallbackExternalId(tx, accountId, isPending);

  // Indizi extra per l'IA (non visibili all'utente nell'UI, ma uniti alla
  // descrizione quando interroghiamo Gemini). Servono soprattutto quando
  // la remittance è povera: il codice MCC (es. 5812 = ristoranti) o
  // purposeCode (es. SALA = stipendio) possono fare la differenza.
  const aiHints: string[] = [];
  if (tx.merchantCategoryCode) {
    aiHints.push(`MCC:${tx.merchantCategoryCode}`);
  }
  if (tx.purposeCode) {
    aiHints.push(`purpose:${tx.purposeCode}`);
  }
  if (tx.proprietaryBankTransactionCode) {
    aiHints.push(`txType:${tx.proprietaryBankTransactionCode}`);
  } else if (tx.bankTransactionCode) {
    aiHints.push(`txType:${tx.bankTransactionCode}`);
  }
  // Se la remittance era generica, includiamo comunque l'etichetta della
  // banca come hint: "Pagamenti paesi UE" ad esempio suggerisce che si
  // tratta di un acquisto con carta in valuta estera.
  if (remittanceIsGeneric && remittance) {
    aiHints.push(`bankLabel:${remittance}`);
  }

  // 4) Log diagnostico: se NON abbiamo cavato fuori niente di meglio
  //    della singola etichetta generica, pubblichiamo su console la
  //    transazione grezza così — alla peggio — l'utente la incolla e
  //    vediamo quali campi stanno davvero arrivando dalla banca. Utile
  //    soprattutto al primo sync di una banca nuova (es. Mediolanum).
  if (remittanceIsGeneric && !counterpartyName) {
    console.warn(
      "[sync/normalize] descrizione povera — dump transazione grezza",
      {
        external_id: externalId,
        amount,
        date,
        // Snapshot dei campi testuali che potrebbero contenere il dettaglio:
        remittanceInformationUnstructured:
          tx.remittanceInformationUnstructured ?? null,
        remittanceInformationUnstructuredArray:
          tx.remittanceInformationUnstructuredArray ?? null,
        remittanceInformationStructured:
          tx.remittanceInformationStructured ?? null,
        remittanceInformationStructuredArray:
          tx.remittanceInformationStructuredArray ?? null,
        additionalInformation: tx.additionalInformation ?? null,
        additionalInformationStructured:
          tx.additionalInformationStructured ?? null,
        creditorName: tx.creditorName ?? null,
        debtorName: tx.debtorName ?? null,
        ultimateCreditor: tx.ultimateCreditor ?? null,
        ultimateDebtor: tx.ultimateDebtor ?? null,
        purposeCode: tx.purposeCode ?? null,
        bankTransactionCode: tx.bankTransactionCode ?? null,
        proprietaryBankTransactionCode:
          tx.proprietaryBankTransactionCode ?? null,
        merchantCategoryCode: tx.merchantCategoryCode ?? null,
        creditorAccount: tx.creditorAccount ?? null,
        debtorAccount: tx.debtorAccount ?? null,
      }
    );
  }

  return {
    external_id: externalId,
    description,
    remittance,
    merchantFallback,
    amount,
    date,
    aiHints: aiHints.length > 0 ? aiHints : undefined,
  };
}

/**
 * Pulisce la `remittanceInformationUnstructured` prima di passarla a Gemini.
 *
 * Le banche italiane spesso arricchiscono questo campo con identificativi
 * tecnici (CRO, TRN, codici pratica, date numeriche, separatori `|`) che non
 * aiutano a riconoscere l'esercente e anzi confondono l'IA. Rimuoviamo i
 * pattern più comuni ma preserviamo il testo descrittivo.
 */
function cleanRemittance(raw: string): string {
  if (!raw) return "";

  let out = raw.replace(/\s+/g, " ").trim();

  // Sigle tecniche seguite da un codice alfanumerico lungo
  // (CRO, TRN, REF, RIF, CID, ID ORDINE, PAN, AUT, ecc.).
  out = out.replace(
    /\b(?:CRO|TRN|TRX|REF|RIF|RIFERIMENTO|CID|ID(?:\s+ORDINE)?|COD(?:ICE)?|PAN|AUT|TRACE|TRACKING|TRK|MANDATO|MANDATE|CREDITOR(?:\s*ID)?|END[-\s]?TO[-\s]?END)\s*[:.#\-=]?\s*[A-Z0-9._/\-]{4,}/gi,
    " "
  );

  // Date numeriche DD/MM/YYYY, YYYY-MM-DD, DD.MM.YY…
  out = out.replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ");
  out = out.replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:]+Z?)?\b/g, " ");

  // Orari tipo 12:34 o 12:34:56
  out = out.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ");

  // Sequenze lunghe di soli numeri (>=8 cifre) → spesso numeri pratica/IBAN.
  out = out.replace(/\b\d{8,}\b/g, " ");

  // Stringhe esadecimali lunghe (UUID, hash…).
  out = out.replace(/\b[0-9A-F]{16,}\b/gi, " ");

  // Separatori residui e doppi spazi.
  out = out
    .replace(/[|_*]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*([,;:])\s*/g, "$1 ")
    .trim();

  // Se dopo la pulizia resta solo punteggiatura/spazi, restituiamo stringa
  // vuota così il chiamante userà un fallback sensato.
  if (!/[A-Za-zÀ-ÿ]/.test(out)) return "";

  return out;
}

/**
 * Costruisce il testo che verrà passato a `analyzeTransaction` (Gemini).
 * Uniamo remittance + controparte per massimizzare la probabilità che l'IA
 * identifichi correttamente merchant e categoria.
 */
function buildAiDescription(params: {
  remittance: string;
  counterparty: string | null;
  fallback: string;
  hints?: string[];
}): string {
  const parts: string[] = [];
  if (params.remittance) parts.push(params.remittance);
  if (params.counterparty && !parts.join(" ").includes(params.counterparty)) {
    parts.push(params.counterparty);
  }
  let out = parts.join(" — ").trim();
  if (!out) out = params.fallback;
  // Appendiamo gli hint "tecnici" (MCC, purposeCode, bankLabel) tra
  // parentesi quadre: facilitano Gemini a distinguere ad es. un POS
  // all'estero da un addebito SDD senza inquinare il testo principale.
  if (params.hints && params.hints.length > 0) {
    out = `${out} [${params.hints.join(", ")}]`;
  }
  return out;
}

function buildFallbackExternalId(
  tx: GoCardlessTransaction,
  accountId: string,
  isPending: boolean
): string {
  const material = [
    accountId,
    tx.bookingDate ?? "",
    tx.valueDate ?? "",
    tx.transactionAmount?.amount ?? "",
    tx.transactionAmount?.currency ?? "",
    tx.creditorName ?? "",
    tx.debtorName ?? "",
    tx.remittanceInformationUnstructured ?? "",
    isPending ? "pending" : "booked",
  ].join("|");
  return createHash("sha1").update(material).digest("hex");
}

/**
 * Variante di `analyzeTransaction` che non propaga mai un errore. Se la
 * chiamata a Gemini fallisce (429, 500, API key mancante, descrizione
 * vuota…) logghiamo il motivo e ritorniamo un fallback "Altro". Il flag
 * `ok` ci serve per contare, a fine sync, quante transazioni sono state
 * davvero categorizzate dall'IA.
 */
async function safeAnalyze(
  description: string,
  userRulesBlock?: string
): Promise<{ analysis: TransactionAnalysis; ok: boolean }> {
  const fallback: TransactionAnalysis = {
    category: "Altro",
    merchant: "",
    tags: [],
    is_subscription: false,
  };

  if (!description?.trim()) {
    console.warn(
      "[sync/analyze] descrizione vuota: categorizzo come 'Altro' senza chiamare Gemini."
    );
    return { analysis: fallback, ok: false };
  }

  try {
    const analysis = await analyzeTransaction(description, {
      userRulesBlock,
    });
    if (!analysis.category || analysis.category === "Altro") {
      // Non è necessariamente un fallimento — "Altro" è una categoria
      // valida — ma logghiamo per visibilità così se riceviamo 100% Altro
      // in un batch sappiamo che serve rivedere il prompt / la remittance.
      console.info(
        "[sync/analyze] Gemini → 'Altro' per descrizione:",
        JSON.stringify(description.slice(0, 80))
      );
    }
    return { analysis, ok: true };
  } catch (err) {
    console.error(
      "[sync/analyze] Gemini KO →",
      err instanceof Error ? err.message : err,
      "— descrizione:",
      JSON.stringify(description.slice(0, 80))
    );
    return { analysis: fallback, ok: false };
  }
}

function pickBalance(balances: Array<{
  balanceAmount?: { amount: string };
  balanceType?: string;
}>): number | null {
  if (!Array.isArray(balances) || balances.length === 0) return null;

  const order = [
    "interimAvailable",
    "closingBooked",
    "expected",
    "interimBooked",
    "forwardAvailable",
  ];
  for (const type of order) {
    const match = balances.find((b) => b.balanceType === type);
    if (match?.balanceAmount?.amount) {
      const n = Number(match.balanceAmount.amount);
      if (Number.isFinite(n)) return n;
    }
  }
  const first = balances[0]?.balanceAmount?.amount;
  if (first) {
    const n = Number(first);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
