"use client";

import { formatCurrency } from "@/lib/mock-data";

type PayloadEntry = {
  name?: string;
  value?: number;
  dataKey?: string | number;
  color?: string;
};

export type GraficiChartTooltipProps = {
  active?: boolean;
  payload?: PayloadEntry[];
  label?: unknown;
  /** Confronto cumulativo periodo vs periodo precedente (chiavi corrente / precedente). */
  variant: "cumulative" | "weekly";
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Tooltip Tremor/Recharts: mostra valori e, se ha senso, variazione % tra le due serie.
 */
export default function GraficiChartTooltip({
  active,
  payload,
  label,
  variant,
}: GraficiChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const rows = payload.filter((p) => p.dataKey != null);
  const byKey = new Map<string, number>();
  for (const p of rows) {
    byKey.set(String(p.dataKey), num(p.value));
  }

  let pctLine: string | null = null;
  if (variant === "weekly") {
    const c = byKey.get("corrente") ?? 0;
    const m = byKey.get("mediaPrecedenti") ?? 0;
    if (m > 0) {
      const pct = ((c - m) / m) * 100;
      pctLine = `Corrente vs media: ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    } else if (c > 0 && m === 0) {
      pctLine = "Corrente vs media: media a zero in questo punto";
    }
  } else {
    const c = byKey.get("corrente") ?? 0;
    const p = byKey.get("precedente") ?? 0;
    if (p > 0) {
      const pct = ((c - p) / p) * 100;
      pctLine = `Corrente vs precedente: ${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    } else if (c > 0 && p === 0) {
      pctLine = "Corrente vs precedente: periodo precedente a zero in questo punto";
    }
  }

  const labelText =
    typeof label === "string" || typeof label === "number"
      ? String(label)
      : "";

  return (
    <div
      className="rounded-xl border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-3 py-2.5 text-[12px] shadow-lg"
      style={{
        boxShadow:
          "0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)",
      }}
    >
      {labelText ? (
        <p className="mb-1.5 font-medium text-[color:var(--color-foreground)]">
          {labelText}
        </p>
      ) : null}
      <ul className="space-y-1">
        {rows.map((p, i) => (
          <li
            key={`${String(p.dataKey)}-${i}`}
            className="flex items-center gap-2 text-[color:var(--color-muted-foreground)]"
          >
            <span
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ backgroundColor: p.color ?? "var(--color-border-strong)" }}
            />
            <span className="text-[color:var(--color-foreground)]">
              {p.name ?? p.dataKey}:{" "}
              <span className="font-medium tabular-nums">
                {formatCurrency(num(p.value))}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {pctLine ? (
        <p className="mt-2 border-t border-[color:var(--color-border)] pt-2 text-[11px] text-[color:var(--color-muted-foreground)]">
          {pctLine}
        </p>
      ) : null}
    </div>
  );
}
