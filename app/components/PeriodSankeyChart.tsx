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
        "relative w-full shrink-0",
        "h-[min(520px,72vh)] min-h-[360px] max-h-[640px]",
        className ?? "",
      ].join(" ")}
    >
      <ResponsiveContainer width="100%" height="100%">
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
            formatter={(v: number | string) =>
              formatCurrency(typeof v === "number" ? v : Number(v))
            }
            contentStyle={{
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "var(--surface, #111113)",
              fontSize: "12px",
            }}
            labelStyle={{ color: "var(--foreground, #f5f5f7)" }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
