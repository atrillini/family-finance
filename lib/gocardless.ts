import "server-only";
import NordigenClient from "nordigen-node";
import { daysSinceFloor, getSyncFloorDate } from "./sync-floor";

/**
 * Client GoCardless Bank Account Data (ex Nordigen).
 *
 * Variabili d'ambiente richieste in `.env.local`:
 *
 *   GOCARDLESS_SECRET_ID="..."        # Secret ID dal portale GoCardless
 *   GOCARDLESS_SECRET_KEY="..."       # Secret Key dal portale GoCardless
 *   NEXT_PUBLIC_APP_URL="https://tuo-dominio.com"
 *                                     # Origine pubblica dell'app (senza slash finale).
 *                                     # Callback di default: `{NEXT_PUBLIC_APP_URL}/api/callback`.
 *                                     # Se assente si usa NEXT_PUBLIC_BASE_URL (legacy), poi localhost.
 *   GOCARDLESS_REDIRECT_URL="https://..." # Override dell'intero URL di callback (priorità massima).
 *
 * Opzionali:
 *   GOCARDLESS_BASE_URL               # Override dell'endpoint API (default
 *                                     # https://bankaccountdata.gocardless.com/api/v2)
 *   GOCARDLESS_MAX_HISTORICAL_DAYS    # Giorni di storico da richiedere (default 730 = 2 anni).
 *                                     # Viene automaticamente clampato al massimo
 *                                     # supportato da ciascuna banca
 *                                     # (campo `transaction_total_days` sull'istituzione).
 *   GOCARDLESS_ACCESS_VALID_DAYS      # Durata del consenso in giorni (default 180)
 *
 * Docs: https://developer.gocardless.com/bank-account-data/overview
 */

export type NordigenClientInstance = InstanceType<typeof NordigenClient>;

type CachedToken = {
  client: NordigenClientInstance;
  expiresAt: number;
};

let cached: CachedToken | null = null;

export function isGoCardlessConfigured(): boolean {
  return Boolean(
    process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY
  );
}

/**
 * Base pubblica dell'app (senza slash finale). Usata per costruire il callback GoCardless.
 * Ordine: NEXT_PUBLIC_APP_URL → NEXT_PUBLIC_BASE_URL → http://localhost:3000
 */
export function getPublicAppBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_BASE_URL?.trim() ||
    "";
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/**
 * URL di default verso cui GoCardless redirige l'utente dopo il consenso.
 * Ordine: `GOCARDLESS_REDIRECT_URL` (override totale), poi `{getPublicAppBaseUrl()}/api/callback`.
 */
export function getDefaultRedirectUrl(): string {
  const explicit = process.env.GOCARDLESS_REDIRECT_URL?.trim();
  if (explicit) return explicit;
  return `${getPublicAppBaseUrl()}/api/callback`;
}

/** @deprecated Usa `getPublicAppBaseUrl()` */
export function getAppOrigin(): string {
  return getPublicAppBaseUrl();
}

export async function getGoCardlessClient(): Promise<NordigenClientInstance> {
  if (!isGoCardlessConfigured()) {
    throw new Error(
      "GoCardless non è configurato. Imposta GOCARDLESS_SECRET_ID e GOCARDLESS_SECRET_KEY in .env.local."
    );
  }

  const now = Date.now();
  if (cached && cached.expiresAt - 60_000 > now) {
    return cached.client;
  }

  const client = new NordigenClient({
    secretId: process.env.GOCARDLESS_SECRET_ID!,
    secretKey: process.env.GOCARDLESS_SECRET_KEY!,
    baseUrl:
      process.env.GOCARDLESS_BASE_URL ||
      "https://bankaccountdata.gocardless.com/api/v2",
  });

  const tokenResp = (await client.generateToken()) as {
    access: string;
    access_expires: number;
  };

  const ttlSec = Number(tokenResp?.access_expires) || 60 * 60 * 24;
  cached = {
    client,
    expiresAt: now + ttlSec * 1000,
  };

  return client;
}

/** Forza la rigenerazione del token (es. dopo un 401). */
export function invalidateGoCardlessClient() {
  cached = null;
}

/**
 * Shape parziale di un'istituzione ritornata dall'API.
 */
export type GoCardlessInstitution = {
  id: string;
  name: string;
  bic?: string;
  transaction_total_days?: string;
  countries?: string[];
  logo?: string;
};

/**
 * Recupera la lista delle banche supportate in un paese (default: Italia).
 */
export async function listInstitutions(
  country: string = "IT"
): Promise<GoCardlessInstitution[]> {
  const client = await getGoCardlessClient();
  const banks = (await client.institution.getInstitutions({ country })) as
    | GoCardlessInstitution[]
    | null;
  return Array.isArray(banks) ? banks : [];
}

/**
 * Mapping in memoria `reference → requisitionId`.
 *
 * Serve perché GoCardless, al termine del consenso, redirige sull'URL di
 * callback aggiungendo `?ref=<reference>` (il valore che abbiamo passato a
 * `initSession`), NON `?ref=<requisitionId>`. Per recuperare la requisition
 * corretta lato callback dobbiamo poter tradurre `reference` → `requisitionId`.
 *
 * In dev la mappa vive nella memoria del processo Node; se il server viene
 * riavviato tra il consenso e il callback, il callback ricade sulla lista
 * `getRequisitions()` filtrata per reference.
 */
const pendingRequisitions = new Map<
  string,
  {
    requisitionId: string;
    institutionId: string;
    createdAt: number;
  }
>();

function rememberRequisition(
  reference: string,
  requisitionId: string,
  institutionId: string
) {
  pendingRequisitions.set(reference, {
    requisitionId,
    institutionId,
    createdAt: Date.now(),
  });
  // housekeeping: droppa voci più vecchie di 2h
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [k, v] of pendingRequisitions) {
    if (v.createdAt < cutoff) pendingRequisitions.delete(k);
  }
}

export function lookupRequisitionByReference(reference: string):
  | { requisitionId: string; institutionId: string }
  | null {
  const hit = pendingRequisitions.get(reference);
  return hit
    ? { requisitionId: hit.requisitionId, institutionId: hit.institutionId }
    : null;
}

/**
 * Risolve un `reference` (o requisition id) ricevuto dal callback nel
 * requisition id canonico.
 *
 * Strategia:
 *   1. Mappa in memoria `reference → requisitionId` popolata da
 *      `createConsentSession`.
 *   2. Fallback: `client.requisition.getRequisitions({ limit: 50 })` e
 *      filtro lato nostro su `reference` (copre il caso in cui il server
 *      sia stato riavviato tra consenso e callback).
 *   3. Ultimo fallback: proviamo a usare il valore ricevuto come id diretto
 *      (`getRequisitionById`) per retro-compatibilità.
 *
 * Ritorna `null` se non troviamo nulla: il chiamante gestirà l'errore.
 */
export async function resolveRequisitionId(
  refOrId: string
): Promise<string | null> {
  const cached = pendingRequisitions.get(refOrId);
  if (cached) {
    console.info(
      "[gocardless] resolveRequisitionId: hit in-memory cache",
      refOrId,
      "→",
      cached.requisitionId
    );
    return cached.requisitionId;
  }

  const client = await getGoCardlessClient();

  try {
    const resp = (await client.requisition.getRequisitions({
      limit: 50,
    })) as { results?: Array<{ id: string; reference?: string }> };
    const list = Array.isArray(resp?.results) ? resp.results : [];
    const found = list.find((r) => r?.reference === refOrId);
    if (found?.id) {
      console.info(
        "[gocardless] resolveRequisitionId: trovato via getRequisitions",
        refOrId,
        "→",
        found.id
      );
      return found.id;
    }
    console.warn(
      "[gocardless] resolveRequisitionId: reference",
      refOrId,
      `non presente tra ${list.length} requisitions recenti`
    );
  } catch (e) {
    console.error(
      "[gocardless] resolveRequisitionId: getRequisitions failed",
      e
    );
  }

  // Ultimo tentativo: magari era già un requisition id.
  try {
    const r = (await client.requisition.getRequisitionById(refOrId)) as {
      id?: string;
    };
    if (r?.id) {
      console.info(
        "[gocardless] resolveRequisitionId: il valore ricevuto era già un requisition id"
      );
      return r.id;
    }
  } catch (e) {
    console.info(
      "[gocardless] resolveRequisitionId: getRequisitionById fallback fallito",
      e instanceof Error ? e.message : e
    );
  }

  return null;
}

/**
 * Crea una sessione di consenso per una banca specifica.
 * Ritorna il link a cui redirigere l'utente e l'ID della requisition
 * (da salvare in DB per poi recuperare gli account dopo il callback).
 */
export async function createConsentSession(params: {
  institutionId: string;
  redirectUrl?: string;
  referenceId?: string;
  userLanguage?: string;
}): Promise<{
  link: string;
  requisitionId: string;
  institutionId: string;
  reference: string;
  maxHistoricalDays: number;
}> {
  const client = await getGoCardlessClient();

  // Di default chiediamo 730 giorni (2 anni): è il massimo ammesso da
  // GoCardless/Nordigen. Il limite reale è comunque deciso dalla banca e
  // pubblicato come `transaction_total_days` sull'istituzione; qui facciamo
  // `min(envMax, bankCapability)` così non finiamo mai a richiedere più
  // storico di quanto la banca sia disposta a concedere (alcune banche
  // tagliano a 90/365/540 giorni). Se il lookup fallisce restiamo sul valore
  // da env: GoCardless internamente ri-clippa comunque al massimo supportato.
  const envMaxHistoricalDays = Number(
    process.env.GOCARDLESS_MAX_HISTORICAL_DAYS || 730
  );
  const accessValidForDays = Number(
    process.env.GOCARDLESS_ACCESS_VALID_DAYS || 180
  );

  // Applichiamo già il "floor" configurato (p.es. SYNC_MIN_DATE=2026-01-01):
  // non ha senso chiedere 2 anni di storico alla banca se poi scartiamo
  // tutto ciò che è precedente al floor. Ci limitiamo ai giorni davvero
  // utili (floor → oggi). Se il floor è molto vicino chiediamo almeno 1
  // giorno per non passare 0 (che alcune banche interpretano male).
  const floorDays = Math.max(1, daysSinceFloor());
  let maxHistoricalDays = Math.min(envMaxHistoricalDays, floorDays);
  console.info(
    "[gocardless] sync floor =",
    getSyncFloorDate(),
    "→ clamp richiesta a",
    maxHistoricalDays,
    "giorni (env max:",
    envMaxHistoricalDays,
    ", giorni-da-floor:",
    floorDays,
    ")"
  );

  try {
    const institution = (await client.institution.getInstitutionById(
      params.institutionId
    )) as { transaction_total_days?: string | number };
    const bankLimit = Number(institution?.transaction_total_days);
    if (Number.isFinite(bankLimit) && bankLimit > 0) {
      maxHistoricalDays = Math.min(maxHistoricalDays, bankLimit);
      console.info(
        "[gocardless] institution cap for",
        params.institutionId,
        "transaction_total_days=",
        bankLimit,
        "→ request",
        maxHistoricalDays,
        "days"
      );
    } else {
      console.warn(
        "[gocardless] institution",
        params.institutionId,
        "senza transaction_total_days: uso valore corrente",
        maxHistoricalDays
      );
    }
  } catch (e) {
    console.warn(
      "[gocardless] lookup institution fallito, uso valore corrente",
      maxHistoricalDays,
      e instanceof Error ? e.message : e
    );
  }

  const reference = params.referenceId ?? crypto.randomUUID();

  const session = (await client.initSession({
    redirectUrl: params.redirectUrl ?? getDefaultRedirectUrl(),
    institutionId: params.institutionId,
    referenceId: reference,
    maxHistoricalDays,
    accessValidForDays,
    userLanguage: params.userLanguage ?? "IT",
    // questi campi sono richiesti dalla firma TS ma opzionali dall'API
    ssn: "",
    redirectImmediate: false,
    accountSelection: false,
  })) as { link: string; id: string };

  rememberRequisition(reference, session.id, params.institutionId);
  console.info("[gocardless] createConsentSession", {
    institutionId: params.institutionId,
    requisitionId: session.id,
    reference,
    maxHistoricalDays,
    accessValidForDays,
  });

  return {
    link: session.link,
    requisitionId: session.id,
    institutionId: params.institutionId,
    reference,
    maxHistoricalDays,
  };
}

/**
 * Elimina la requisition (e quindi il consenso bancario) su GoCardless.
 * È l'operazione corretta per "scollegare una banca": dopo la cancellazione
 * non sarà più possibile scaricare transazioni finché non si crea una nuova
 * requisition.
 *
 * Ritorna `true` se la cancellazione è andata a buon fine (o se la
 * requisition era già stata rimossa), `false` se l'API ha restituito un
 * errore che non vogliamo propagare al client (es. requisition scaduta).
 */
export async function deleteRequisition(
  requisitionId: string
): Promise<boolean> {
  if (!requisitionId) return false;
  const client = await getGoCardlessClient();
  try {
    await client.requisition.deleteRequisition(requisitionId);
    console.info("[gocardless] requisition eliminata", requisitionId);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 = già eliminata: trattiamola come successo.
    if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
      console.info(
        "[gocardless] requisition già assente su GoCardless, ok",
        requisitionId
      );
      return true;
    }
    console.error("[gocardless] deleteRequisition KO", requisitionId, msg);
    return false;
  }
}

/**
 * Shape minimo del dettaglio di un account (dall'endpoint `/accounts/{id}/details`).
 */
export type GoCardlessAccountDetails = {
  account?: {
    iban?: string;
    name?: string;
    ownerName?: string;
    product?: string;
    currency?: string;
  };
};

/**
 * Shape minimo del balance ritornato da GoCardless.
 */
export type GoCardlessBalance = {
  balanceAmount?: { amount: string; currency: string };
  balanceType?: string;
  referenceDate?: string;
};

/**
 * Shape di una transazione GoCardless (booked/pending).
 *
 * Seguiamo lo schema Berlin Group NextGenPSD2 il più fedelmente possibile:
 * le PSD2 italiane (Mediolanum inclusa) popolano spesso SOLO alcuni campi
 * e lasciano vuoto `remittanceInformationUnstructured`, mettendo la
 * descrizione utile in `remittanceInformationUnstructuredArray`,
 * `remittanceInformationStructured*` o `additionalInformation`.
 *
 * Per esempio Mediolanum usa frequentemente:
 *   - `remittanceInformationUnstructured` = "Pagamenti paesi UE" (etichetta
 *     generica del tipo operazione, NON il merchant);
 *   - `remittanceInformationUnstructuredArray` = array di righe con il
 *     vero dettaglio (merchant, città, importo originale in valuta estera);
 *   - `creditorName` = spesso vuoto per pagamenti di carta, valorizzato
 *     per bonifici;
 *   - `proprietaryBankTransactionCode` = codice interno utile a capire
 *     che tipo di movimento è (POS, SEPA, addebito SDD…).
 *
 * Teniamo quindi il tipo largo e flessibile: campi sconosciuti sono ok.
 */
export type GoCardlessTransaction = {
  transactionId?: string;
  internalTransactionId?: string;
  entryReference?: string;
  endToEndId?: string;
  mandateId?: string;
  creditorId?: string;

  bookingDate?: string;
  valueDate?: string;
  bookingDateTime?: string;
  valueDateTime?: string;

  transactionAmount?: { amount: string; currency: string };
  currencyExchange?: Array<{
    sourceCurrency?: string;
    targetCurrency?: string;
    exchangeRate?: string;
    unitCurrency?: string;
    instructedAmount?: { amount: string; currency: string };
  }>;

  creditorName?: string;
  creditorAccount?: { iban?: string; bban?: string; currency?: string };
  creditorAgent?: string;
  ultimateCreditor?: string;

  debtorName?: string;
  debtorAccount?: { iban?: string; bban?: string; currency?: string };
  debtorAgent?: string;
  ultimateDebtor?: string;

  // Varianti "unstructured": testo libero (spesso l'utile si trova qui)
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];

  // Varianti "structured": meno usate in Italia ma presenti su alcune banche
  remittanceInformationStructured?: string;
  remittanceInformationStructuredArray?: string[];

  additionalInformation?: string;
  // Oggetto libero (Berlin Group lo descrive come Map<String, String>)
  additionalInformationStructured?: Record<string, string>;

  // Codici di categoria / tipo movimento
  purposeCode?: string;
  bankTransactionCode?: string;
  proprietaryBankTransactionCode?: string;
  merchantCategoryCode?: string;

  // Link ai balance (raramente utile per noi)
  balanceAfterTransaction?: unknown;

  // Catch-all: alcune banche mandano campi extra non-standard; li
  // logghiamo per diagnosi senza farli scomparire nella coercizione.
  [key: string]: unknown;
};

/**
 * Helper per recuperare metadati (details, balances, transactions) di un account
 * GoCardless in una volta sola.
 */
export async function fetchAccountSnapshot(
  gocardlessAccountId: string,
  params?: { dateFrom?: string; dateTo?: string }
): Promise<{
  details: GoCardlessAccountDetails;
  balances: GoCardlessBalance[];
  booked: GoCardlessTransaction[];
  pending: GoCardlessTransaction[];
}> {
  const client = await getGoCardlessClient();
  const account = client.account(gocardlessAccountId);

  const [details, balancesResp, txResp] = await Promise.all([
    account.getDetails() as Promise<GoCardlessAccountDetails>,
    account.getBalances() as Promise<{ balances?: GoCardlessBalance[] }>,
    (
      params?.dateFrom || params?.dateTo
        ? account.getTransactions({
            dateFrom: params?.dateFrom ?? "",
            dateTo: params?.dateTo ?? "",
            country: "",
          })
        : account.getTransactions()
    ) as Promise<{
      transactions?: {
        booked?: GoCardlessTransaction[];
        pending?: GoCardlessTransaction[];
      };
    }>,
  ]);

  return {
    details: details ?? {},
    balances: balancesResp?.balances ?? [],
    booked: txResp?.transactions?.booked ?? [],
    pending: txResp?.transactions?.pending ?? [],
  };
}
