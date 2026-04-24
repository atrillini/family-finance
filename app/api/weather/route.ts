import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Meteo OpenWeather (Current weather 2.5).
 *
 * Variabili d'ambiente (Vercel / .env.local):
 * - OPENWEATHER_API_KEY  (obbligatoria per dati reali)
 * - OPENWEATHER_LAT + OPENWEATHER_LON  (opzionali)
 * - OPENWEATHER_CITY     (default "Milano,IT" se lat/lon assenti)
 *
 * Debug locale: GET /api/weather?diagnose=1 (solo NODE_ENV=development).
 *
 * Debug su Vercel (senza esporre la chiave al pubblico): imposta
 * `WEATHER_DIAGNOSE_SECRET` su Vercel (stringa lunga casuale), poi:
 *   GET /api/weather?diagnose=1&secret=<WEATHER_DIAGNOSE_SECRET>
 * Risponde con keyLength, presenza key, VERCEL_ENV, ecc.
 *
 * Il fetch verso OpenWeather usa `cache: "no-store"` per evitare
 * che Next memorizzi a lungo una risposta 401 dopo aver corretto la key.
 */
function readOpenWeatherKey(): string {
  const raw = process.env.OPENWEATHER_API_KEY ?? "";
  return raw.replace(/^\uFEFF/, "").trim();
}

function diagnosePayload() {
  const key = readOpenWeatherKey();
  return {
    keyPresent: key.length > 0,
    keyLength: key.length,
    hasInnerNewlines: /[\r\n]/.test(key),
    hasSurroundingQuotes:
      (key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'")),
    vercel: Boolean(process.env.VERCEL),
    vercelEnv: process.env.VERCEL_ENV ?? null,
    nodeEnv: process.env.NODE_ENV ?? null,
    openweatherCityConfigured: Boolean(
      process.env.OPENWEATHER_CITY?.replace(/^\uFEFF/, "").trim()
    ),
    openweatherLatLonConfigured: Boolean(
      process.env.OPENWEATHER_LAT?.trim() && process.env.OPENWEATHER_LON?.trim()
    ),
    hint:
      "Vercel: la variabile deve essere abilitata per l'ambiente del deploy (Production vs Preview), nome esatto OPENWEATHER_API_KEY, poi Redeploy. In dashboard Vercel → Deployment → Functions → Logs puoi vedere errori runtime.",
  };
}

function diagnoseSecretOk(requestUrl: URL): boolean {
  const expected = process.env.WEATHER_DIAGNOSE_SECRET?.trim() ?? "";
  const got = requestUrl.searchParams.get("secret") ?? "";
  if (!expected || expected.length < 16) return false;
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(got, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const wantsDiagnose = reqUrl.searchParams.get("diagnose") === "1";

  if (wantsDiagnose && process.env.NODE_ENV === "development") {
    const d = diagnosePayload();
    return NextResponse.json({
      mode: "diagnose",
      ...d,
      hint:
        d.hint +
        " Locale: riavvia `npm run dev` dopo .env.local. Chiavi nuove OpenWeather possono richiedere fino a ~2 ore.",
    });
  }

  if (wantsDiagnose && diagnoseSecretOk(reqUrl)) {
    return NextResponse.json({
      mode: "diagnose",
      ...diagnosePayload(),
    });
  }

  if (wantsDiagnose) {
    return NextResponse.json(
      {
        error: "diagnose_forbidden",
        message:
          "In produzione aggiungi WEATHER_DIAGNOSE_SECRET su Vercel e chiama ?diagnose=1&secret=<quel valore>. In locale basta ?diagnose=1.",
      },
      { status: 403 }
    );
  }

  const key = readOpenWeatherKey();
  if (!key) {
    return NextResponse.json(
      {
        ok: false as const,
        reason: "missing_api_key",
        message: "Imposta OPENWEATHER_API_KEY in .env.local o su Vercel.",
        vercelEnv: process.env.VERCEL_ENV ?? undefined,
        hint:
          process.env.VERCEL
            ? "Su Vercel: Settings → Environment Variables → OPENWEATHER_API_KEY deve essere selezionata per Production (o Preview se stai su un URL preview). Salva e fai Redeploy del progetto."
            : undefined,
      },
      { status: 200 }
    );
  }

  const lat = process.env.OPENWEATHER_LAT?.replace(/^\uFEFF/, "").trim();
  const lon = process.env.OPENWEATHER_LON?.replace(/^\uFEFF/, "").trim();
  const city =
    process.env.OPENWEATHER_CITY?.replace(/^\uFEFF/, "").trim() ||
    "Milano,IT";

  const url =
    lat && lon
      ? `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=metric&lang=it&appid=${encodeURIComponent(key)}`
      : `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&lang=it&appid=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    if (!res.ok) {
      let message = text.slice(0, 240);
      try {
        const j = JSON.parse(text) as { message?: string; cod?: number };
        if (typeof j.message === "string" && j.message.trim())
          message = j.message.trim();
      } catch {
        /* testo non JSON */
      }
      const vercelHint =
        process.env.VERCEL && res.status === 401
          ? "Se in locale funziona: su Vercel spesso la key non è nel deploy giusto (Production vs Preview), c’è uno spazio/carattere in più nella variabile, oppure stai usando un altro progetto Vercel. Usa ?diagnose=1&secret=… con WEATHER_DIAGNOSE_SECRET per controllare keyLength senza esporre la chiave."
          : undefined;
      return NextResponse.json(
        {
          ok: false as const,
          reason: "upstream_error",
          status: res.status,
          message,
          vercelEnv: process.env.VERCEL_ENV ?? undefined,
          hint: vercelHint,
        },
        { status: 200 }
      );
    }

    const json = JSON.parse(text) as {
      name?: string;
      main?: { temp?: number; feels_like?: number };
      weather?: Array<{ description?: string; icon?: string }>;
    };

    const w0 = json.weather?.[0];
    const temp = json.main?.temp;
    const description = w0?.description ?? "";
    const icon = w0?.icon ?? "01d";
    const cityName = json.name ?? city.split(",")[0] ?? "—";

    return NextResponse.json(
      {
        ok: true as const,
        city: cityName,
        tempC: typeof temp === "number" ? temp : null,
        description,
        iconCode: icon,
        iconUrl: `https://openweathermap.org/img/wn/${icon}@2x.png`,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false as const,
        reason: "fetch_failed",
        message: e instanceof Error ? e.message : "Errore di rete",
      },
      { status: 200 }
    );
  }
}
