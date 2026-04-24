"use client";

import { useCallback } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import GraficiChartTooltip, {
  type GraficiChartTooltipProps,
} from "./GraficiChartTooltip";
import { formatCurrency } from "@/lib/mock-data";
import type { WeeklyBurnRow } from "@/lib/weekly-burn-chart";

const STROKE_CORRENTE = "#60a5fa";
const STROKE_MEDIA = "#fbbf24";

type Props = {
  data: WeeklyBurnRow[];
  className?: string;
};

/**
 * Burn rate settimanale con Recharts e stroke SVG espliciti: evita il bug Tremor
 * per cui le linee non comparivano in dark (stroke da classi Tailwind su SVG).
 */
export default function WeeklyBurnLineChart({ data, className }: Props) {
  const tooltipContent = useCallback((props: TooltipProps<number, string>) => {
    const { active, payload, label } = props;
    const mapped = (payload ?? []).map((p) => ({
      name: String(p.name ?? p.dataKey ?? ""),
      value: Number(p.value),
      dataKey: String(p.dataKey ?? ""),
      color: typeof p.color === "string" ? p.color : undefined,
    })) as GraficiChartTooltipProps["payload"];
    return (
      <GraficiChartTooltip
        active={active}
        payload={mapped}
        label={label}
        variant="weekly"
      />
    );
  }, []);

  return (
    <div className={className ?? "mt-6 h-80 w-full"}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 28, right: 12, left: 4, bottom: 4 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(150, 150, 160, 0.2)"
            vertical={false}
          />
          <XAxis
            dataKey="giorno"
            tick={{ fontSize: 11, fill: "#98989f" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            width={72}
            tick={{ fontSize: 11, fill: "#98989f" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatCurrency(Number(v))}
          />
          <Tooltip content={tooltipContent} cursor={{ stroke: "#6b7280", strokeWidth: 1 }} />
          <Legend
            verticalAlign="top"
            height={24}
            formatter={(value) => (
              <span className="text-[11px] text-[color:var(--color-muted-foreground)]">
                {value === "corrente"
                  ? "Settimana corrente"
                  : value === "mediaPrecedenti"
                    ? "Media settimane precedenti"
                    : String(value)}
              </span>
            )}
          />
          <Line
            type="monotone"
            dataKey="corrente"
            name="corrente"
            stroke={STROKE_CORRENTE}
            strokeWidth={2.75}
            dot={{ r: 4, fill: STROKE_CORRENTE, stroke: "rgba(0,0,0,0.35)", strokeWidth: 1 }}
            activeDot={{
              r: 6,
              fill: STROKE_CORRENTE,
              stroke: "rgba(255,255,255,0.9)",
              strokeWidth: 2,
            }}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="mediaPrecedenti"
            name="mediaPrecedenti"
            stroke={STROKE_MEDIA}
            strokeWidth={2.75}
            dot={{ r: 4, fill: STROKE_MEDIA, stroke: "rgba(0,0,0,0.35)", strokeWidth: 1 }}
            activeDot={{
              r: 6,
              fill: STROKE_MEDIA,
              stroke: "rgba(255,255,255,0.9)",
              strokeWidth: 2,
            }}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
