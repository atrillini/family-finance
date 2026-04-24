"use client";

import { useMemo } from "react";
import {
  Rectangle,
  ResponsiveContainer,
  Sankey,
  Tooltip,
} from "recharts";
import { formatCurrency } from "@/lib/mock-data";
import {
  PERIOD_SANKEY_CENTER_LABEL,
  type PeriodSankeyData,
} from "@/lib/sankey-period";

type Props = {
  data: PeriodSankeyData;
  className?: string;
};

type TooltipRow = { name?: unknown; value?: unknown };

/** Tooltip dedicato: DefaultTooltipContent + filterNull escludeva a volte il Sankey; colori da :root. */
function SankeyTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly TooltipRow[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  if (!row) return null;
  const label =
    row.name != null && String(row.name).trim() !== ""
      ? String(row.name)
      : "Voce";
  const raw = row.value;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : NaN;
  const valueStr = Number.isFinite(n) ? formatCurrency(n) : "—";

  return (
    <div
      className="max-w-[280px] rounded-xl border px-3 py-2 shadow-lg"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        color: "var(--foreground)",
      }}
    >
      <p className="text-[11px] font-semibold leading-snug break-words">
        {label}
      </p>
      <p className="mt-1 text-[13px] font-medium tabular-nums">{valueStr}</p>
    </div>
  );
}

/**
 * Sankey Recharts: entrate (sinistra) → centro → uscite (destra).
 * Colori e stroke espliciti per dark mode.
 */
export default function PeriodSankeyChart({ data, className }: Props) {
  const centerIdx = useMemo(
    () =>
      data.nodes.findIndex((n) => n.name === PERIOD_SANKEY_CENTER_LABEL),
    [data.nodes]
  );

  const chartData = useMemo(
    () => ({ nodes: data.nodes, links: data.links }),
    [data]
  );

  const nodeRenderer = useMemo(() => {
    const cIdx = centerIdx >= 0 ? centerIdx : 0;
    return (props: {
      x: number;
      y: number;
      width: number;
      height: number;
      index: number;
    }) => {
      const { x, y, width, height, index } = props;
      let fill = "#64748b";
      if (index < cIdx) fill = "#3b82f6";
      else if (index > cIdx) fill = "#f59e0b";
      else fill = "#475569";
      return (
        <Rectangle
          x={x}
          y={y}
          width={width}
          height={height}
          fill={fill}
          rx={4}
          ry={4}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1}
        />
      );
    };
  }, [centerIdx]);

  /* Altezza fissa obbligatoria: con solo min-height, height:100% del figlio = 0 e il Sankey non renderizza. */
  return (
    <div
      className={[
        "relative z-0 w-full shrink-0 overflow-visible",
        "h-[min(520px,72vh)] min-h-[360px] max-h-[640px]",
        className ?? "",
      ].join(" ")}
    >
      <ResponsiveContainer width="100%" height="100%" className="overflow-visible">
        <Sankey
          data={chartData}
          nameKey="name"
          dataKey="value"
          nodePadding={18}
          nodeWidth={14}
          linkCurvature={0.62}
          iterations={64}
          margin={{ top: 12, right: 24, bottom: 12, left: 24 }}
          sort
          node={nodeRenderer}
          link={{
            stroke: "rgba(96, 165, 250, 0.35)",
            strokeOpacity: 0.9,
          }}
        >
          <Tooltip
            content={<SankeyTooltipContent />}
            filterNull={false}
            isAnimationActive={false}
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 50, outline: "none" }}
            cursor={{ stroke: "rgba(148, 163, 184, 0.5)", strokeWidth: 1 }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
