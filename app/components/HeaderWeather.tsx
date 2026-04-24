"use client";

import { useEffect, useState } from "react";
import { CloudOff, Loader2 } from "lucide-react";

type WeatherOk = {
  ok: true;
  city: string;
  tempC: number | null;
  description: string;
  iconUrl: string;
};

type WeatherErr = {
  ok: false;
  reason?: string;
  message?: string;
};

export default function HeaderWeather() {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ok"; data: WeatherOk }
    | { status: "err"; data: WeatherErr }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/weather", { cache: "no-store" });
        const json = (await res.json()) as WeatherOk | WeatherErr;
        if (cancelled) return;
        if (
          json &&
          "ok" in json &&
          json.ok &&
          typeof (json as WeatherOk).tempC === "number"
        ) {
          setState({ status: "ok", data: json as WeatherOk });
        } else {
          setState({ status: "err", data: json as WeatherErr });
        }
      } catch {
        if (!cancelled) setState({ status: "err", data: { ok: false } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <div
        className="flex h-9 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-2.5 text-[color:var(--color-muted-foreground)]"
        title="Meteo"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        <span className="hidden text-[11px] sm:inline">Meteo…</span>
      </div>
    );
  }

  if (state.status === "err") {
    return (
      <div
        className="flex h-9 items-center gap-1 rounded-full border border-dashed border-[color:var(--color-border)] px-2 text-[color:var(--color-muted-foreground)]"
        title={
          state.status === "err" && state.data.message
            ? state.data.message
            : "Meteo: configura OPENWEATHER_API_KEY"
        }
      >
        <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="hidden text-[11px] sm:inline">Meteo</span>
      </div>
    );
  }

  const d = state.data;
  return (
    <div
      className="flex h-9 max-w-[200px] items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/50 px-2 py-0.5"
      title={`${d.city} — ${d.description}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={d.iconUrl}
        alt=""
        width={28}
        height={28}
        className="shrink-0"
      />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[11px] font-medium tabular-nums text-[color:var(--color-foreground)]">
          {d.tempC != null ? `${d.tempC.toFixed(0)}°` : "—"}
        </p>
        <p className="hidden truncate text-[10px] text-[color:var(--color-muted-foreground)] sm:block">
          {d.city}
        </p>
      </div>
    </div>
  );
}
