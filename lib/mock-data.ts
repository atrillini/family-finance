import type { AccountRow, TransactionRow } from "./supabase";

export type Transaction = TransactionRow;
export type Account = AccountRow;

/**
 * Conti di esempio usati quando Supabase non è configurato. Gli `id`
 * vengono referenziati dai mock transactions tramite `account_id`.
 */
const MOCK_ACCOUNT_DEFAULTS = {
  user_id: null,
  iban: null,
  institution_id: null,
  requisition_id: null,
  gocardless_account_id: null,
  last_sync_at: null,
} as const;

export const MOCK_ACCOUNTS: Account[] = [
  {
    id: "acc-revolut",
    name: "Revolut",
    type: "conto corrente",
    balance: 1820.75,
    logo_url: null,
    created_at: "2026-01-01T10:00:00Z",
    ...MOCK_ACCOUNT_DEFAULTS,
  },
  {
    id: "acc-intesa",
    name: "Intesa Sanpaolo",
    type: "conto corrente",
    balance: 4250.1,
    logo_url: null,
    created_at: "2026-01-01T10:00:00Z",
    ...MOCK_ACCOUNT_DEFAULTS,
  },
  {
    id: "acc-vacanze",
    name: "Pocket Vacanze",
    type: "pocket",
    balance: 540.0,
    logo_url: null,
    created_at: "2026-02-01T10:00:00Z",
    ...MOCK_ACCOUNT_DEFAULTS,
  },
  {
    id: "acc-deposito",
    name: "Conto Deposito",
    type: "risparmio",
    balance: 3200.0,
    logo_url: null,
    created_at: "2026-01-01T10:00:00Z",
    ...MOCK_ACCOUNT_DEFAULTS,
  },
];

const MOCK_TX_DEFAULTS = {
  external_id: null,
  is_transfer: false,
  user_id: null,
} as const;

export const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: "t-001",
    date: "2026-04-18",
    description: "Spesa settimanale",
    merchant: "Esselunga",
    category: "Alimentari",
    amount: -127.4,
    tags: ["famiglia", "casa"],
    is_subscription: false,
    account_id: "acc-intesa",
    created_at: "2026-04-18T10:00:00Z",
    ...MOCK_TX_DEFAULTS,
  },
  {
    id: "t-002",
    date: "2026-04-17",
    description: "Stipendio aprile",
    merchant: "Acme S.r.l.",
    category: "Stipendio",
    amount: 2850.0,
    tags: ["fisso"],
    is_subscription: false,
    account_id: "acc-intesa",
    created_at: "2026-04-17T10:00:00Z",
    ...MOCK_TX_DEFAULTS,
  },
  {
    id: "t-003",
    date: "2026-04-16",
    description: "Pizzeria con la famiglia",
    merchant: "Da Michele",
    category: "Ristoranti",
    amount: -62.5,
    tags: ["tempo libero", "sociale"],
    is_subscription: false,
    account_id: "acc-revolut",
    created_at: "2026-04-16T10:00:00Z",
    ...MOCK_TX_DEFAULTS,
  },
  {
    id: "t-004",
    date: "2026-04-15",
    description: "Abbonamento streaming",
    merchant: "Netflix",
    category: "Svago",
    amount: -17.99,
    tags: ["streaming", "digitale", "tempo libero"],
    is_subscription: true,
    account_id: "acc-revolut",
    created_at: "2026-04-15T10:00:00Z",
    ...MOCK_TX_DEFAULTS,
  },
  {
    id: "t-005",
    date: "2026-04-14",
    description: "Rifornimento auto",
    merchant: "Eni Station",
    category: "Trasporti",
    amount: -70.2,
    tags: ["carburante"],
    is_subscription: false,
    account_id: "acc-intesa",
    created_at: "2026-04-14T10:00:00Z",
    ...MOCK_TX_DEFAULTS,
  },
  {
    id: "t-006",
    date: "2026-04-12",
    description: "Bolletta luce",
    merchant: "Enel Energia",
    category: "Bollette",
    amount: -98.15,
    tags: ["casa", "fisso"],
    is_subscription: true,
    account_id: "acc-intesa",
    created_at: "2026-04-12T10:00:00Z",
    ...MOCK_TX_DEFAULTS,
  },
  {
    id: "t-007",
    date: "2026-04-10",
    description: "Accredito risparmio",
    merchant: "Conto Deposito",
    category: "Risparmio",
    amount: 300.0,
    tags: ["fisso"],
    is_subscription: false,
    account_id: "acc-deposito",
    created_at: "2026-04-10T10:00:00Z",
    ...MOCK_TX_DEFAULTS,
  },
  {
    id: "t-008",
    date: "2026-04-08",
    description: "Farmacia – integratori",
    merchant: "Farmacia Comunale",
    category: "Salute",
    amount: -24.6,
    tags: ["salute"],
    is_subscription: false,
    account_id: "acc-revolut",
    created_at: "2026-04-08T10:00:00Z",
    ...MOCK_TX_DEFAULTS,
  },
];

export type MonthlySummary = {
  balance: number;
  income: number;
  expenses: number;
};

/**
 * Calcola entrate/uscite/cashflow di una lista di transazioni, **escludendo
 * i giroconti** (`is_transfer === true`). Un giroconto è uno spostamento di
 * denaro fra conti dello stesso utente: entrerebbe una volta come uscita e
 * una come entrata dello stesso importo e gonfierebbe entrambi i totali.
 */
export function computeMonthlySummary(
  transactions: Transaction[]
): MonthlySummary {
  return transactions.reduce<MonthlySummary>(
    (acc, t) => {
      if (t.is_transfer) return acc;
      if (t.amount >= 0) acc.income += t.amount;
      else acc.expenses += Math.abs(t.amount);
      acc.balance += t.amount;
      return acc;
    },
    { balance: 0, income: 0, expenses: 0 }
  );
}

/**
 * Variazione percentuale fra valore corrente e precedente.
 * Ritorna `null` se il valore precedente è 0 (infinito non ha senso UX).
 */
export function percentDelta(
  current: number,
  previous: number
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Tipi che l'utente può assegnare a un conto. Sono stringhe libere a livello
 * di DB (campo `text`) ma qui teniamo l'elenco "canonico" usato dal selettore
 * nel modal di modifica del conto, così UX e logica di aggregazione restano
 * allineate.
 */
export const ACCOUNT_TYPES = [
  "conto corrente",
  "carta",
  "pocket",
  "salvadanaio",
  "risparmio",
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * Un conto è considerato "pocket / salvadanaio" se nel `type` compare una
 * delle keyword pocket/salvadanaio. Usiamo `includes` (case-insensitive) così
 * che funzioni anche se l'utente ha scritto "Pocket Vacanze" o
 * "Salvadanaio Viaggi" come valore libero. Gli account di tipo "risparmio"
 * NON sono considerati pocket: quelli rientrano nel saldo totale.
 */
export function isPocketAccount(account: Account): boolean {
  const t = (account.type || "").toLowerCase();
  return t.includes("pocket") || t.includes("salvadanai");
}

/**
 * Somma dei saldi dei conti "attivi" (conto corrente, carta, risparmio, ...).
 * Per default esclude i salvadanai/pocket così che il Saldo Totale rifletta
 * la liquidità realmente disponibile. Passa `includePockets: true` se vuoi il
 * patrimonio complessivo.
 */
export function computeAccountsTotal(
  accounts: Account[],
  opts?: { includePockets?: boolean }
): number {
  const includePockets = opts?.includePockets ?? false;
  return accounts.reduce((sum, a) => {
    if (!includePockets && isPocketAccount(a)) return sum;
    return sum + Number(a.balance ?? 0);
  }, 0);
}

/**
 * Somma dei soli conti contrassegnati come salvadanaio/pocket.
 * Utile per mostrare un dato informativo accanto al saldo totale.
 */
export function computePocketTotal(accounts: Account[]): number {
  return accounts.reduce(
    (sum, a) => (isPocketAccount(a) ? sum + Number(a.balance ?? 0) : sum),
    0
  );
}

/**
 * Formattazione euro **deterministica** (identica su server e client).
 *
 * Non usiamo `Intl.NumberFormat("it-IT")` perché Node.js per default è
 * compilato con *small-icu* e supporta solo la locale "en-US": quando gli
 * chiedi "it-IT" fa fallback a un formato parziale (es. `9270,85 €`),
 * mentre il browser — che ha l'ICU completo — produce `9.270,85 €`.
 * I due output divergono e React solleva "Hydration failed because the
 * server rendered text didn't match the client".
 *
 * Qui formattiamo a mano: punto migliaia, virgola decimale, simbolo euro
 * in coda. Zero dipendenze da ICU, output identico ovunque.
 */
export function formatCurrency(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  // Spezza in parte intera e decimale, arrotondata a 2 cifre.
  const [intRaw, decRaw = "00"] = abs.toFixed(2).split(".");
  // Inserisce il punto come separatore delle migliaia (dalla fine).
  const intWithSep = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return `${sign}${intWithSep},${decRaw} €`;
}

const IT_MONTHS_SHORT = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
] as const;

/**
 * Formattazione data breve deterministica (es. "20 apr"). Stessa
 * motivazione di `formatCurrency`: evitiamo `Intl.DateTimeFormat`
 * per non rischiare differenze server/client.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = IT_MONTHS_SHORT[d.getMonth()];
  return `${day} ${month}`;
}

/**
 * Etichette "tipo operazione" generiche delle banche italiane: da sole
 * non identificano un movimento e vanno nascoste dal titolo breve.
 */
const GENERIC_BANK_PREFIXES = [
  "pagamenti paesi ue",
  "pagamenti paesi extra ue",
  "pagamento pos",
  "pagamento pos estero",
  "acquisto pos",
  "acquisto pos estero",
  "addebito sdd",
  "addebito diretto",
  "bonifico ricevuto",
  "bonifico a vostro favore",
  "bonifico estero",
  "bonifico sepa",
  "prelievo bancomat",
  "commissioni",
  "spese",
  "disposizione",
  "operazione",
  "movimento",
] as const;

function stripGenericBankPrefix(s: string): string {
  const trimmed = s.trim();
  const lower = trimmed.toLowerCase();
  for (const p of GENERIC_BANK_PREFIXES) {
    if (lower.startsWith(p)) {
      return trimmed.slice(p.length).replace(/^[\s\-·:|]+/, "").trim();
    }
  }
  return trimmed;
}

/**
 * Ritorna un titolo breve e leggibile dalla descrizione "ricca" ottenuta
 * da GoCardless, da mostrare IN TABELLA. Il testo completo resta sempre
 * disponibile (tooltip + modale di modifica).
 *
 * Strategia, in ordine di priorità:
 *
 *   1. Pattern Mediolanum/Nexi `C/O <NOME> - CARTA …` → restituisce <NOME>.
 *   2. Pattern bonifico `BONIFICO A VOSTRO FAVORE - <X> · Note: …` →
 *      restituisce "Bonifico <X>" troncato alla prima pausa.
 *   3. Se c'è un `merchant` valorizzato e NON generico → lo preferisce.
 *   4. Altrimenti: primo segmento "sensato" della description, dopo aver
 *      rimosso eventuale prefisso generico della banca.
 *
 * Limitiamo il risultato a ~70 caratteri: la cella poi fa `truncate` con
 * ellissi se serve, ma la stringa di partenza è già pulita.
 */
export function shortenDescription(
  description: string,
  merchant?: string | null
): string {
  const desc = (description ?? "").trim();
  if (!desc) return merchant?.trim() || "Transazione";

  // 1) C/O <NOME> - CARTA  →  <NOME>  (merchant reale di POS estero/UE)
  const coCarta = desc.match(/C\/O\s+([^·|]*?)\s*-\s*CARTA\b/i);
  if (coCarta && coCarta[1]) {
    return clampLength(sanitizeLabel(coCarta[1]), 70);
  }

  // 1b) "C/O <NOME>" senza "- CARTA" (capita su alcuni circuiti)
  const co = desc.match(/C\/O\s+([^·|]+)/i);
  if (co && co[1]) {
    // Fermiamoci alla prima "parola tecnica" tipo CIRCUITO/Cod./Causale…
    const cut = co[1]
      .split(/\b(?:CIRCUITO|Cod\.|Causale|CARTA|transactionOfTheDay)\b/i)[0]
      ?.trim();
    if (cut) return clampLength(sanitizeLabel(cut), 70);
  }

  // 2) BONIFICO A VOSTRO FAVORE - <X>
  const bonifico = desc.match(/BONIFICO\s+A\s+VOSTRO\s+FAVORE\s*-\s*([^·|]+)/i);
  if (bonifico && bonifico[1]) {
    const who = bonifico[1]
      .split(/\b(?:Note|Data\s+Regolamento|Banca\s+Ordinante)\b/i)[0]
      ?.trim();
    if (who) return clampLength(`Bonifico ${sanitizeLabel(who)}`, 70);
  }

  // 3) Merchant (se esiste e non è generico)
  const m = (merchant ?? "").trim();
  if (m && !isGeneric(m)) {
    return clampLength(sanitizeLabel(m), 70);
  }

  // 4) Fallback: prendiamo il primo segmento non-generico della
  //    description (separatori ` · ` o ` | `), rimuovendo il prefisso
  //    "tipo operazione" della banca se presente.
  const segments = desc.split(/\s*[·|]\s*/g).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const cleaned = stripGenericBankPrefix(seg);
    if (cleaned && cleaned.length > 2 && !isGeneric(cleaned)) {
      return clampLength(sanitizeLabel(cleaned), 70);
    }
  }

  // 5) Ultima spiaggia: la prima frase della description "grezza",
  //    eventualmente troncata.
  return clampLength(sanitizeLabel(desc), 70);
}

function sanitizeLabel(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/[_*]+/g, " ")
    .replace(/^[\s\-–—·:|]+|[\s\-–—·:|]+$/g, "")
    .trim();
}

function clampLength(s: string, max: number): string {
  if (s.length <= max) return s;
  // Proviamo a tagliare allo spazio più vicino per non spezzare parole.
  const slice = s.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max - 15 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

function isGeneric(s: string): boolean {
  const low = s.trim().toLowerCase();
  if (!low || low.length <= 3) return true;
  return GENERIC_BANK_PREFIXES.some(
    (p) => low === p || low.startsWith(`${p} `)
  );
}
