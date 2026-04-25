/**
 * Quotazione per ISIN tramite Twelve Data (symbol_search + quote).
 * Richiede `TWELVE_DATA_API_KEY` lato server.
 */

type SymbolSearchEntry = {
  symbol: string;
  instrument_name: string;
  exchange: string;
  mic_code: string;
  instrument_type: string;
  country: string;
  currency: string;
};

type TwelveErrorBody = {
  status?: string;
  code?: number;
  message?: string;
};

function isSearchEntry(v: unknown): v is SymbolSearchEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.symbol === "string" &&
    typeof o.exchange === "string" &&
    typeof o.mic_code === "string" &&
    typeof o.currency === "string" &&
    typeof o.instrument_name === "string"
  );
}

/** Normalizza e valida ISIN (12 caratteri alfanumerici + check digit). */
export function normalizeIsin(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return null;
  return s;
}

function pickListing(matches: SymbolSearchEntry[]): SymbolSearchEntry | null {
  if (!matches.length) return null;
  const eur = matches.filter((m) => m.currency === "EUR");
  const pool = eur.length ? eur : matches;
  const milan = pool.find((m) => m.mic_code === "XMIL");
  if (milan) return milan;
  const xetr = pool.find((m) => m.mic_code === "XETR");
  if (xetr) return xetr;
  const xams = pool.find((m) => m.mic_code === "XAMS");
  if (xams) return xams;
  return pool[0];
}

function parseQuoteClose(body: Record<string, unknown>): {
  price: number;
  currency: string;
  datetime: string;
} {
  const currency =
    typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim()
      : "XXX";
  const datetime =
    typeof body.datetime === "string" && body.datetime.trim()
      ? body.datetime.trim()
      : new Date().toISOString();
  const raw =
    body.close ?? body.previous_close ?? body.open ?? body.price ?? null;
  const price =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.replace(",", "."))
        : NaN;
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Quotazione senza prezzo valido (close).");
  }
  return { price, currency, datetime };
}

export type IsinUnitQuote = {
  isin: string;
  unitPrice: number;
  currency: string;
  symbol: string;
  exchange: string;
  micCode: string;
  instrumentName: string;
  quotedAt: string;
};

/**
 * Ultimo prezzo unitario per l’ISIN (listino scelto con euristica EUR / MTA / XETRA).
 */
export async function fetchUnitQuoteByIsin(
  isin: string,
  apiKey: string
): Promise<IsinUnitQuote> {
  const normalized = normalizeIsin(isin);
  if (!normalized) {
    throw new Error("ISIN non valido (12 caratteri, es. IE00B4L5Y983).");
  }

  const searchUrl = new URL("https://api.twelvedata.com/symbol_search");
  searchUrl.searchParams.set("symbol", normalized);
  searchUrl.searchParams.set("apikey", apiKey);

  const searchRes = await fetch(searchUrl.toString(), {
    next: { revalidate: 0 },
  });
  const searchJson = (await searchRes.json()) as TwelveErrorBody & {
    data?: unknown[];
  };

  if (searchJson.status === "error" || searchJson.code === 401) {
    throw new Error(
      searchJson.message?.trim() ||
        "Ricerca simbolo fallita (controlla la API key Twelve Data)."
    );
  }

  const entries = (searchJson.data ?? []).filter(isSearchEntry);
  const listing = pickListing(entries);
  if (!listing) {
    throw new Error("Nessun titolo trovato per questo ISIN.");
  }

  const quoteUrl = new URL("https://api.twelvedata.com/quote");
  quoteUrl.searchParams.set("symbol", listing.symbol);
  quoteUrl.searchParams.set("mic_code", listing.mic_code);
  quoteUrl.searchParams.set("apikey", apiKey);

  const quoteRes = await fetch(quoteUrl.toString(), { next: { revalidate: 0 } });
  const quoteJson = (await quoteRes.json()) as TwelveErrorBody &
    Record<string, unknown>;

  if (quoteJson.status === "error") {
    throw new Error(
      quoteJson.message?.trim() || "Impossibile leggere la quotazione."
    );
  }

  let { price, currency, datetime } = parseQuoteClose(quoteJson);

  // Listini UK in penny sterline: il prezzo API è in pence → sterline.
  if (currency === "GBp" || listing.currency === "GBp") {
    price = price / 100;
    currency = "GBP";
  }

  return {
    isin: normalized,
    unitPrice: price,
    currency,
    symbol: listing.symbol,
    exchange: listing.exchange,
    micCode: listing.mic_code,
    instrumentName: listing.instrument_name,
    quotedAt: datetime,
  };
}
