import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Meteo OpenWeather (Current weather 2.5).
 *
 * Variabili d'ambiente (Vercel / .env.local):
 * - OPENWEATHER_API_KEY  (obbligatoria per dati reali)
 * - OPENWEATHER_LAT + OPENWEATHER_LON  (opzionali, es. 45.4642 e 9.1900 per Milano)
 *   oppure
 * - OPENWEATHER_CITY     (default "Milano,IT" se lat/lon assenti)
 *
 * Esempio .env.local:
 *   OPENWEATHER_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   OPENWEATHER_CITY=Milano,IT
 *
 * Chiave gratuita: https://openweathermap.org/api — registrazione → API keys.
 */
export async function GET() {
  const key = process.env.OPENWEATHER_API_KEY?.trim();
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

  const lat = process.env.OPENWEATHER_LAT?.trim();
  const lon = process.env.OPENWEATHER_LON?.trim();
  const city =
    process.env.OPENWEATHER_CITY?.trim() || "Milano,IT";

  const url =
    lat && lon
      ? `https://api.openweathermap.org/data/2.5/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=metric&lang=it&appid=${encodeURIComponent(key)}`
      : `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&lang=it&appid=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, { next: { revalidate: 600 } });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        {
          ok: false as const,
          reason: "upstream_error",
          status: res.status,
          message: text.slice(0, 200),
        },
        { status: 200 }
      );
    }

    const json = (await res.json()) as {
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
