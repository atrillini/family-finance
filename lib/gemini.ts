import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { estimateGeminiCostUsd } from "./gemini-cost";

/**
 * Categorie standard usate dall'app per classificare le transazioni.
 * L'IA restituirà sempre una di queste etichette.
 */
export const TRANSACTION_CATEGORIES = [
  "Alimentari",
  "Ristoranti",
  "Trasporti",
  "Casa",
  "Bollette",
  "Salute",
  "Istruzione",
  "Svago",
  "Abbigliamento",
  "Viaggi",
  "Stipendio",
  "Risparmio",
  "Altro",
] as const;

export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

/**
 * Oggetto strutturato restituito dall'analisi di Gemini per una transazione.
 */
export type TransactionAnalysis = {
  /** Categoria principale, presa dalla lista `TRANSACTION_CATEGORIES`. */
  category: TransactionCategory;
  /** Nome pulito e leggibile dell'esercente (es. "Netflix", "Esselunga"). */
  merchant: string;
  /** Tag descrittivi (es. "tempo libero", "sociale", "e-commerce"). */
  tags: string[];
  /** `true` se Gemini riconosce un abbonamento ricorrente. */
  is_subscription: boolean;
  /** `true` se è un giroconto / trasferimento fra propri conti (esclude statistiche entrate/uscite). */
  is_transfer: boolean;
};

let cachedClient: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY non è impostata. Aggiungila al file .env.local per abilitare le funzionalità IA."
    );
  }

  if (!cachedClient) {
    cachedClient = new GoogleGenerativeAI(apiKey);
  }

  return cachedClient;
}

/**
 * Nome del modello Gemini di default.
 * Override possibile impostando la variabile d'ambiente `GEMINI_MODEL`.
 * Modelli validi: "gemini-2.5-flash", "gemini-2.5-pro", "gemini-flash-latest",
 * "gemini-2.0-flash". I modelli della serie 1.5 sono stati deprecati su v1beta.
 */
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

/**
 * Restituisce il modello Gemini pronto all'uso.
 * `gemini-2.5-flash` è veloce, economico e adatto alla classificazione testuale.
 */
export function getGeminiModel(modelName: string = DEFAULT_MODEL) {
  return getClient().getGenerativeModel({ model: modelName });
}

/**
 * Modello configurato per restituire un oggetto JSON tipizzato secondo
 * lo schema di `TransactionAnalysis`.
 */
function getAnalysisModel() {
  return getClient().getGenerativeModel({
    model: DEFAULT_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          category: {
            type: SchemaType.STRING,
            format: "enum",
            enum: [...TRANSACTION_CATEGORIES],
            description: "Categoria principale della transazione.",
          },
          merchant: {
            type: SchemaType.STRING,
            description:
              "Nome pulito dell'esercente. Stringa vuota se non identificabile.",
          },
          tags: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            description:
              "Tag descrittivi, minuscoli, 1-4 elementi. Esempi: 'tempo libero', 'sociale', 'e-commerce', 'fisso', 'digitale'.",
          },
          is_subscription: {
            type: SchemaType.BOOLEAN,
            description:
              "true se la transazione sembra un abbonamento ricorrente (Netflix, Spotify, gym, SaaS...).",
          },
          is_transfer: {
            type: SchemaType.BOOLEAN,
            description:
              "true solo per bonifici/giroconti tra propri conti o carte dello stesso intestatario; altrimenti false.",
          },
        },
        required: [
          "category",
          "merchant",
          "tags",
          "is_subscription",
          "is_transfer",
        ],
      },
    },
  });
}

const EMPTY_ANALYSIS: TransactionAnalysis = {
  category: "Altro",
  merchant: "",
  tags: [],
  is_subscription: false,
  is_transfer: false,
};

/**
 * Analizza la descrizione di una transazione e restituisce un oggetto
 * strutturato con categoria, merchant, tag e flag di abbonamento.
 *
 * Esempio:
 *   await analyzeTransaction("Abbonamento mensile Netflix")
 *   // => {
 *   //      category: "Svago",
 *   //      merchant: "Netflix",
 *   //      tags: ["streaming", "digitale", "tempo libero"],
 *   //      is_subscription: true
 *   //    }
 */
/**
 * Contesto opzionale da passare a Gemini durante l'analisi di una transazione.
 * `userRulesBlock` è una stringa già formattata (vedi `formatRulesForPrompt` in
 * `lib/categorization-rules.ts`): la passiamo al modello come "memoria" degli
 * schemi che l'utente vuole rispettare, così per descrizioni simili ma non
 * esatte l'IA imita lo stile dell'utente.
 */
export type AnalyzeTransactionContext = {
  userRulesBlock?: string;
  /** Esempi recenti delle correzioni manuali (`formatExamplesForPrompt`). */
  userExamplesBlock?: string;
};

/**
 * Unisce i blocchi testuali già formattati (regole utente + esempi few-shot).
 * Usato da sync, `/api/categorize` e ricategorizzazione.
 */
export function buildAnalyzeTransactionContext(
  rulesFormatted: string,
  examplesFormatted: string
): AnalyzeTransactionContext | undefined {
  const rules = rulesFormatted.trim();
  const examples = examplesFormatted.trim();
  if (!rules && !examples) return undefined;
  return {
    ...(rules ? { userRulesBlock: rules } : {}),
    ...(examples ? { userExamplesBlock: examples } : {}),
  };
}

/** Metriche token/costo singola chiamata categorizzazione (Gemini). */
export type GeminiUsageMetrics = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export const EMPTY_GEMINI_USAGE: GeminiUsageMetrics = {
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
};

function usageFromGenerateContentResponse(result: {
  response?: {
    text: () => string;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}): GeminiUsageMetrics {
  const u = result.response?.usageMetadata ?? result.usageMetadata;

  const inputTokens = Math.max(
    0,
    Number(
      u?.promptTokenCount ??
        (u as { prompt_token_count?: number } | undefined)?.prompt_token_count ??
        0
    )
  );
  let outputTokens = Math.max(
    0,
    Number(
      u?.candidatesTokenCount ??
        (u as { candidates_token_count?: number } | undefined)
          ?.candidates_token_count ??
        0
    )
  );
  if (!outputTokens && u?.totalTokenCount != null && inputTokens >= 0) {
    const total = Math.max(
      0,
      Number(
        u.totalTokenCount ??
          (u as { total_token_count?: number } | undefined)?.total_token_count ??
          0
      )
    );
    outputTokens = Math.max(0, total - inputTokens);
  }
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateGeminiCostUsd(inputTokens, outputTokens),
  };
}

/**
 * Come `analyzeTransaction`, ma espone anche token stimati e costo USD della chiamata.
 */
export async function analyzeTransactionWithMetrics(
  description: string,
  context?: AnalyzeTransactionContext
): Promise<{ analysis: TransactionAnalysis; usage: GeminiUsageMetrics }> {
  const cleaned = description?.trim();
  if (!cleaned) {
    return { analysis: { ...EMPTY_ANALYSIS }, usage: { ...EMPTY_GEMINI_USAGE } };
  }

  const model = getAnalysisModel();

  const rulesSection = context?.userRulesBlock?.trim();
  const examplesSection = context?.userExamplesBlock?.trim();

  const prompt = [
    "Sei un assistente finanziario che analizza transazioni bancarie di una famiglia italiana.",
    "Restituisci SOLO un oggetto JSON conforme allo schema fornito.",
    "",
    "Regole:",
    `- 'category' deve essere una di: ${TRANSACTION_CATEGORIES.join(", ")}.`,
    "- 'merchant' è il nome pulito del negozio/servizio (es. 'Netflix', 'Esselunga'). Usa stringa vuota se non identificabile.",
    "- 'tags' sono 1-4 etichette descrittive in minuscolo. Esempi: 'tempo libero', 'sociale', 'e-commerce', 'fisso', 'digitale', 'famiglia', 'salute', 'casa'.",
    "- 'is_subscription' è true se è un abbonamento ricorrente (streaming, SaaS, palestra, telefono, luce/gas, ecc.), altrimenti false.",
    "- 'is_transfer' è true solo per trasferimenti fra propri conti/carte (giroconti); per pagamenti verso terzi o acquisti è false.",
    "- Per i ristoranti aggiungi tag come 'tempo libero' e 'sociale'.",
    "- Per gli acquisti online aggiungi il tag 'e-commerce'.",
    rulesSection
      ? [
          "",
          "Memoria personale dell'utente (RISPETTA questi schemi quando la descrizione sembra rientrarvi, anche approssimativamente):",
          rulesSection,
        ].join("\n")
      : "",
    examplesSection
      ? [
          "",
          "Esempi delle sue correzioni recenti (usa lo stesso stile di categorie/tag quando la transazione è analoga, anche senza match letterale):",
          examplesSection,
        ].join("\n")
      : "",
    "",
    `Transazione: "${cleaned}"`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await model.generateContent(prompt);
  const raw = result.response.text();
  const usage = usageFromGenerateContentResponse(result);

  return { analysis: parseAnalysis(raw), usage };
}

export async function analyzeTransaction(
  description: string,
  context?: AnalyzeTransactionContext
): Promise<TransactionAnalysis> {
  const { analysis } = await analyzeTransactionWithMetrics(description, context);
  return analysis;
}

function parseAnalysis(raw: string): TransactionAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_ANALYSIS };
  }

  if (!parsed || typeof parsed !== "object") {
    return { ...EMPTY_ANALYSIS };
  }

  const obj = parsed as Record<string, unknown>;

  const category = TRANSACTION_CATEGORIES.find(
    (c) => c.toLowerCase() === String(obj.category ?? "").toLowerCase()
  );

  const merchant =
    typeof obj.merchant === "string" ? obj.merchant.trim() : "";

  const tags = Array.isArray(obj.tags)
    ? obj.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
        .slice(0, 4)
    : [];

  const is_subscription = Boolean(obj.is_subscription);
  const is_transfer = Boolean(obj.is_transfer);

  return {
    category: category ?? "Altro",
    merchant,
    tags,
    is_subscription,
    is_transfer,
  };
}

/**
 * Wrapper retro-compatibile: restituisce solo la categoria.
 * Internamente usa l'analisi strutturata di `analyzeTransaction`.
 */
export async function suggestTransactionCategory(
  description: string
): Promise<TransactionCategory> {
  const { category } = await analyzeTransaction(description);
  return category;
}

// ---------------------------------------------------------------------------
// Natural Language → Supabase filter
// ---------------------------------------------------------------------------

/**
 * Colonne della tabella `transactions` che la ricerca intelligente può filtrare.
 */
export const FILTERABLE_COLUMNS = [
  "description",
  "amount",
  "category",
  "tags",
  "date",
  "merchant",
] as const;
export type FilterableColumn = (typeof FILTERABLE_COLUMNS)[number];

/**
 * Operatori supportati. Vengono mappati su metodi del client Supabase:
 *   eq          → .eq()
 *   gt          → .gt()
 *   gte         → .gte()
 *   lt          → .lt()
 *   lte         → .lte()
 *   ilike       → .ilike()  (testo case-insensitive con wildcard %)
 *   containedBy → .contains() (per colonne array, es. `tags`)
 */
export const FILTER_OPERATORS = [
  "eq",
  "gt",
  "gte",
  "lt",
  "lte",
  "ilike",
  "containedBy",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export type QueryFilter = {
  column: FilterableColumn;
  operator: FilterOperator;
  value: string | number;
};

export type ParsedQuery = {
  filter: QueryFilter;
  explanation: string;
};

/**
 * Analizza una query in linguaggio naturale e la traduce in un filtro
 * applicabile sulla tabella `transactions` di Supabase.
 *
 * Esempi:
 *   "tutte le spese sopra i 50 euro"  →
 *     { filter: { column: "amount", operator: "lt", value: -50 },
 *       explanation: "Filtro le uscite superiori a 50 €." }
 *
 *   "acquisti da Netflix"             →
 *     { filter: { column: "merchant", operator: "ilike", value: "%Netflix%" },
 *       explanation: "Cerco transazioni con esercente che contiene 'Netflix'." }
 *
 *   "transazioni con tag vacanza"     →
 *     { filter: { column: "tags", operator: "containedBy", value: "vacanza" },
 *       explanation: "Filtro le transazioni etichettate come 'vacanza'." }
 */
export async function parseNaturalLanguageQuery(
  query: string
): Promise<ParsedQuery | null> {
  const cleaned = query?.trim();
  if (!cleaned) return null;

  const today = new Date().toISOString().slice(0, 10);

  const systemPrompt = [
    "Sei un assistente esperto in database SQL e Supabase. Il tuo compito è convertire le richieste dell'utente in un oggetto JSON di filtri.",
    "",
    "La tabella del database si chiama 'transactions' ed ha queste colonne:",
    "- description (testo)",
    "- amount (numero: i valori negativi sono uscite, positivi entrate)",
    `- category (testo, uno tra: ${TRANSACTION_CATEGORIES.join(", ")})`,
    "- tags (array di testi: es. ['lavoro', 'vacanza', 'abbonamento', 'streaming', 'tempo libero'])",
    "- date (data in formato ISO, es. 2026-04-20)",
    "- merchant (testo)",
    "",
    "Devi restituire esclusivamente un oggetto JSON con questa struttura:",
    '{ "filter": { "column": "nome_colonna", "operator": "eq" | "gt" | "gte" | "lt" | "lte" | "ilike" | "containedBy", "value": "valore" }, "explanation": "una breve frase in italiano che spiega cosa stai filtrando" }',
    "",
    "Regole:",
    "- Per ricerche testuali su description o merchant usa 'ilike' con il valore tra simboli % (es. '%netflix%').",
    "- Per i tag usa l'operatore 'containedBy' e come value passa il nome del singolo tag in minuscolo (es. 'vacanza').",
    "- Se l'utente chiede 'spese' o 'uscite', filtra per amount < 0 usando operator 'lt' con value 0.",
    "- Se l'utente chiede 'entrate', filtra per amount > 0 usando operator 'gt' con value 0.",
    "- Per importi specifici (es. 'sopra i 50 euro'), converti in numero (es. 50 o -50 se parla di uscite).",
    `- Per riferimenti temporali (es. 'oggi', 'questo mese', 'anno scorso', 'a Natale', 'dicembre 2025') calcola le date considerando che oggi è ${today} e usa il formato ISO YYYY-MM-DD.`,
    "- Per un intervallo di date (es. 'anno scorso', 'dal 1 gennaio al 31 marzo') scegli il vincolo più utile: spesso basta un solo limite (es. tutto il 2025 con date gte 2025-01-01 e date lte 2025-12-31) — se serve un solo filtro, preferisci quello che copre meglio l'intento (es. gte sul primo giorno dell'anno per 'anno scorso').",
    "- Per combinare concetto + periodo (es. 'regali Natale anno scorso'), usa prima il filtro più selettivo: spesso description o tags con ilike (es. '%regalo%' o '%natale%') e menziona il periodo nell'explanation; se puoi esprimere il periodo con un solo vincolo su date (gte/lte), usalo.",
    "- Se la query è ambigua, scegli il filtro più probabile e spiegalo chiaramente in 'explanation'.",
    "",
    `Richiesta utente: "${cleaned}"`,
  ].join("\n");

  const model = getClient().getGenerativeModel({
    model: DEFAULT_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.OBJECT,
        properties: {
          filter: {
            type: SchemaType.OBJECT,
            properties: {
              column: {
                type: SchemaType.STRING,
                format: "enum",
                enum: [...FILTERABLE_COLUMNS],
              },
              operator: {
                type: SchemaType.STRING,
                format: "enum",
                enum: [...FILTER_OPERATORS],
              },
              value: {
                type: SchemaType.STRING,
                description:
                  "Valore del filtro come stringa. Per i numeri, scrivi il numero come stringa (es. '-50').",
              },
            },
            required: ["column", "operator", "value"],
          },
          explanation: { type: SchemaType.STRING },
        },
        required: ["filter", "explanation"],
      },
    },
  });

  const result = await model.generateContent(systemPrompt);
  const raw = result.response.text();

  return parseParsedQuery(raw);
}

// ---------------------------------------------------------------------------
// Analisi finanziaria (chat Q&A in linguaggio naturale)
// ---------------------------------------------------------------------------

/**
 * Dati per `analyzeFinance`: campi essenziali + tag/merchant per filtri in linguaggio naturale.
 */
export type FinanceTx = {
  description: string;
  amount: number;
  category: string;
  date: string;
  /** Tag in minuscolo o misti; array vuoto se assenti. */
  tags: string[];
  /** Esercente o null. */
  merchant: string | null;
};

function parseTagsField(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Normalizza un oggetto JSON arbitrario in `FinanceTx` (es. body API `/api/analyze`). */
export function coerceFinanceTxFromJson(t: Record<string, unknown>): FinanceTx {
  return {
    description: String(t.description ?? ""),
    amount: Number(t.amount ?? 0),
    category: String(t.category ?? ""),
    date: String(t.date ?? ""),
    tags: parseTagsField(t.tags),
    merchant:
      typeof t.merchant === "string" && t.merchant.trim()
        ? t.merchant.trim()
        : null,
  };
}

/**
 * Contesto opzionale passato al modello insieme alla domanda.
 * `dateRange` comunica il periodo attualmente selezionato nella dashboard:
 * serve a Gemini per interpretare domande ambigue sul tempo ("quanto ho
 * speso?") nel modo atteso dall'utente.
 */
export type AnalyzeContext = {
  dateRange?: {
    fromIso: string;
    toIso: string;
    label?: string;
  };
};

/**
 * Risponde a una domanda dell'utente in linguaggio naturale usando come
 * contesto una sintesi delle sue transazioni. La risposta è in Markdown.
 *
 * Esempi di domande:
 *   - "Quanto ho speso su Netflix questo mese?"
 *   - "Posso permettermi una cena fuori?"
 *   - "Dammi 3 consigli per risparmiare."
 */
export async function analyzeFinance(
  userQuery: string,
  transactions: FinanceTx[],
  context?: AnalyzeContext
): Promise<string> {
  const cleaned = userQuery?.trim();
  if (!cleaned) return "";

  // Record estesi (es. da client che serializza `Transaction`) con soft delete.
  const visible = transactions.filter(
    (t) => (t as unknown as { is_hidden?: boolean }).is_hidden !== true
  );

  const todayIT = new Intl.DateTimeFormat("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  const summary = visible.slice(0, 200).map((t) => ({
    description: t.description,
    amount: Number(t.amount),
    category: t.category,
    date: t.date,
    tags: parseTagsField(t.tags),
    merchant:
      typeof t.merchant === "string" && t.merchant.trim()
        ? t.merchant.trim()
        : null,
  }));

  // Sezione "periodo selezionato": formattiamo in italiano il range così
  // Gemini può citarlo direttamente nella risposta senza trasformazioni.
  const fmtIT = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("it-IT", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  };

  const range = context?.dateRange;
  const rangeSection: string[] = [];
  if (range) {
    const fromIT = fmtIT(range.fromIso);
    const toIT = fmtIT(range.toIso);
    const label = range.label ? ` (${range.label})` : "";
    rangeSection.push(
      `- Periodo selezionato dall'utente nella dashboard: dal ${fromIT} al ${toIT}${label}.`,
      "- Le transazioni in allegato contengono SOLO quel periodo (il filtro è già applicato).",
      "- Se la domanda dell'utente non specifica un intervallo temporale, ragiona rispetto a questo periodo e citalo esplicitamente nella risposta.",
      "- Se invece l'utente indica un periodo diverso, spiega gentilmente che stai vedendo solo i dati filtrati e invitalo a cambiare il filtro."
    );
  } else {
    rangeSection.push(
      "- L'utente non ha applicato filtri temporali: hai a disposizione tutte le transazioni recenti."
    );
  }

  const systemPrompt = [
    "Sei un esperto analista finanziario. Hai accesso ai dati delle transazioni dell'utente (che ti vengono forniti in formato JSON).",
    "Il tuo compito è rispondere in modo preciso, conciso e cordiale alle domande dell'utente.",
    "",
    "Regole:",
    "- Importi: **negativo** = uscita/spesa, **positivo** = entrata. Per 'quanto ho guadagnato / entrate' somma solo importi > 0 (nel periodo se applicabile); per spese somma importi < 0.",
    "- Ogni transazione ha `tags` (array di stringhe). Se l'utente chiede filtri per un tag (es. 'movimenti con tag lavoro'), considera solo le righe dove `tags` contiene quel termine, **confronto case-insensitive** (es. 'Lavoro' matcha tag 'lavoro'). Se nessuna riga ha quel tag, dillo chiaramente.",
    "- Per 'entrate con tag T' / 'uscite con tag T': dopo il filtro tag, tieni solo importi rispettivamente **> 0** o **< 0**.",
    "- Il campo `merchant` è l'esercente quando presente; puoi usarlo insieme a description per ricerche.",
    "- Se l'utente chiede un totale per categoria o merchant, filtra prima poi somma gli importi coerenti con la domanda (uscite vs entrate).",
    "- Se l'utente chiede un totale (es. 'totale Netflix'), identifica le righe pertinenti e somma con la convenzione segno sopra.",
    "- Se l'utente chiede un consiglio, analizza le tendenze (es. 'stai spendendo molto in svago questo mese').",
    "- Rispondi sempre in Markdown per rendere i numeri in grassetto e le liste leggibili.",
    "- Usa il formato € (Euro) per gli importi, es. **€ 42,50**.",
    "- Se la domanda non c'entra con le finanze, rifiuta gentilmente e invita a fare una domanda pertinente.",
    `- Data di oggi per riferimento: ${todayIT}.`,
    "",
    "Contesto temporale:",
    ...rangeSection,
    "",
    "Dati delle transazioni (JSON):",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
    "",
    `Domanda dell'utente: "${cleaned}"`,
  ].join("\n");

  const model = getGeminiModel();
  const result = await model.generateContent(systemPrompt);
  return result.response.text().trim();
}

function parseParsedQuery(raw: string): ParsedQuery | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const filterObj = obj.filter as Record<string, unknown> | undefined;
  const explanation =
    typeof obj.explanation === "string" ? obj.explanation : "";

  if (!filterObj) return null;

  const column = FILTERABLE_COLUMNS.find(
    (c) => c === String(filterObj.column ?? "")
  );
  const operator = FILTER_OPERATORS.find(
    (o) => o === String(filterObj.operator ?? "")
  );

  if (!column || !operator) return null;

  const rawValue = filterObj.value;
  let value: string | number;

  if (column === "amount") {
    const num =
      typeof rawValue === "number"
        ? rawValue
        : Number.parseFloat(String(rawValue ?? "").replace(",", "."));
    if (!Number.isFinite(num)) return null;
    value = num;
  } else {
    value = String(rawValue ?? "").trim();
    if (!value) return null;
  }

  return {
    filter: { column, operator, value },
    explanation,
  };
}

// ---------------------------------------------------------------------------
// Insight sui grafici (solo aggregati — niente elenco transazioni)
// ---------------------------------------------------------------------------

export type ChartInsightTopTag = {
  tag: string;
  amount: number;
  sharePct: number;
};

export type ChartInsightPayload = {
  periodCurrentLabel: string;
  periodPreviousLabel: string;
  expenseCurrent: number;
  expensePrevious: number;
  expenseDeltaPct: number | null;
  /** Uscite ripartite per tag (importo diviso tra i tag di ogni transazione). */
  topTagsCurrent: ChartInsightTopTag[];
  weeklyBurn?: {
    weekLabel: string;
    spendCumulativeEnd: number;
    avgPreviousWeeksCumulativeEnd: number;
  };
};

/**
 * Breve commento in italiano su andamento uscite e tag, usando solo
 * numeri aggregati (privacy / costo contenuti).
 */
export async function generateChartInsightFromAggregates(
  payload: ChartInsightPayload
): Promise<string> {
  const top = payload.topTagsCurrent
    .slice(0, 8)
    .map(
      (r) =>
        `- tag "${r.tag}": €${r.amount.toFixed(2)} (${r.sharePct.toFixed(1)}% delle uscite)`
    )
    .join("\n");

  const deltaLine =
    payload.expenseDeltaPct == null
      ? "Variazione % sul periodo precedente: non calcolabile (periodo precedente a zero)."
      : `Variazione uscite vs periodo precedente: ${payload.expenseDeltaPct > 0 ? "+" : ""}${payload.expenseDeltaPct.toFixed(1)}%.`;

  const weeklyBlock = payload.weeklyBurn
    ? [
        "",
        "Burn rate settimanale (cumulativo nel corso della settimana, confrontato con la media delle settimane precedenti):",
        `- Settimana di riferimento: ${payload.weeklyBurn.weekLabel}`,
        `- Spesa cumulativa alla data di confronto: €${payload.weeklyBurn.spendCumulativeEnd.toFixed(2)}`,
        `- Media allo stesso giorno nelle settimane precedenti (stesso campione del grafico): €${payload.weeklyBurn.avgPreviousWeeksCumulativeEnd.toFixed(2)}`,
      ].join("\n")
    : "";

  const aggregates = [
    "Sei un assistente finanziario informale per una famiglia italiana.",
    "Ti vengono forniti SOLO totali e percentuali aggregate (nessun dettaglio di singole transazioni).",
    "",
    "Scrivi in italiano **al massimo 2 frasi** (o 1 frase + un elenco puntato molto breve di al più 3 punti).",
    "Enfasi sui **tag** (es. famiglia, lavoro, vacanza): non usare categorie di bilancio generiche (es. Svago, Alimentari) salvo se indispensabile.",
    "Tono: chiaro, concreto, senza allarmismi. Non dare consigli di investimento né raccomandazioni fiscali.",
    "Non inventare cifre: usa solo quelle nel blocco dati.",
    "",
    "Dati:",
    `- Periodo corrente: ${payload.periodCurrentLabel}`,
    `- Periodo precedente (confronto): ${payload.periodPreviousLabel}`,
    `- Uscite totali periodo corrente: €${payload.expenseCurrent.toFixed(2)}`,
    `- Uscite totali periodo precedente: €${payload.expensePrevious.toFixed(2)}`,
    `- ${deltaLine}`,
    "",
    "Uscite ripartite per TAG nel periodo corrente (top) — privilegia i tag nei commenti, non le categorie generiche:",
    top || "(nessuna uscita o nessun tag nel periodo)",
    weeklyBlock,
    "",
    "Rispondi in Markdown leggero (opzionale **grassetto** sui numeri principali).",
  ].join("\n");

  const model = getGeminiModel();
  const result = await model.generateContent(aggregates);
  return result.response.text().trim();
}

// ---------------------------------------------------------------------------
// Narrativa scenario investimenti (solo numeri già calcolati dall’app)
// ---------------------------------------------------------------------------

export type InvestmentNarrativePayload = {
  startingPrincipal: number;
  annualReturnPct: number;
  monthlyContribution: number;
  horizonYears: number;
  endValue: number;
  totalContributions: number;
  marketComponent: number;
  /** Se il capitale iniziale includeva anche i saldi conto. */
  includeLiquidityInPrincipal: boolean;
};

/**
 * Commento breve in italiano su una proiezione già calcolata (nessun consiglio
 * di investimento: solo linguaggio naturale sui numeri forniti).
 */
export async function generateInvestmentScenarioNarrative(
  payload: InvestmentNarrativePayload
): Promise<string> {
  const liq = payload.includeLiquidityInPrincipal
    ? "Il capitale iniziale include anche una stima della liquidità sui conti."
    : "Il capitale iniziale coincide con la somma dei valori attuali delle posizioni manuali.";

  const prompt = [
    "Sei un assistente che spiega in italiano, in modo sobrio e non allarmistico,",
    "una **simulazione numerica** già calcolata dall’applicazione (non fare calcoli tuoi: usa solo le cifre sotto).",
    "",
    "Vincoli:",
    "- Al massimo **2 paragrafi brevi** o **3 bullet**.",
    "- Non dare consigli di investimento, né fiscali, né di prodotto finanziario.",
    "- Non presentare il risultato come garantito o previsione di mercato.",
    "- Puoi usare Markdown leggero.",
    "",
    "Dati della simulazione:",
    `- Orizzonte: ${payload.horizonYears} anni`,
    `- Rendimento annuo ipotizzato (nominale, composto mensilmente): ${payload.annualReturnPct.toFixed(2)}%`,
    `- Versamento mensile ipotizzato: €${payload.monthlyContribution.toFixed(2)}`,
    `- Capitale iniziale considerato: €${payload.startingPrincipal.toFixed(2)} (${liq})`,
    `- Valore finale stimato dall’app: €${payload.endValue.toFixed(2)}`,
    `- Somma versamenti nel periodo: €${payload.totalContributions.toFixed(2)}`,
    `- Componente attribuibile al rendimento (valore finale − capitale iniziale − versamenti): €${payload.marketComponent.toFixed(2)}`,
  ].join("\n");

  const model = getGeminiModel();
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}
