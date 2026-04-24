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
 * Debug (solo `NODE_ENV=development`): GET /api/weather?diagnose=1
 * restituisce lunghezza chiave e hint senza esporre la chiave intera.
 *
 * Nota: il fetch verso OpenWeather usa `cache: "no-store"` per evitare
 * che Next memorizzi a lungo una risposta 401 dopo aver corretto la key.
 */
function readOpenWeatherKey(): string {
  const raw = process.env.OPENWEATHER_API_KEY ?? "";
  return raw.replace(/^\uFEFF/, "").trim();
}

export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  if (
    reqUrl.searchParams.get("diagnose") === "1" &&
    process.env.NODE_ENV === "development"
  ) {
    const key = readOpenWeatherKey();
    return NextResponse.json({
      env: "development",
      keyPresent: key.length > 0,
      keyLength: key.length,
      hasInnerNewlines: /[\r\n]/.test(key),
      hasSurroundingQuotes:
        (key.startsWith('"') && key.endsWith('"')) ||
        (key.startsWith("'") && key.endsWith("'")),
      hint:
        "Riavvia `npm run dev` dopo aver modificato .env.local. Le chiavi nuove su openweathermap.org possono richiedere fino a ~2 ore. Il nome della variabile deve essere esattamente OPENWEATHER_API_KEY.",
    });
  }

  const key = readOpenWeatherKey();
  if (!key) {
    return NextResponse.json(
      {
        ok: false as const,
        reason: "missing_api_key",
        message: "Imposta OPENWEATHER_API_KEY in .env.local o su Vercel.",
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
      return NextResponse.json(
        {
          ok: false as const,
          reason: "upstream_error",
          status: res.status,
          message,
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
