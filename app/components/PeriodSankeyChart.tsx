"use client";

import { useCallback, useMemo, useState } from "react";
import { ResponsiveContainer, Sankey } from "recharts";
import { formatCurrency } from "@/lib/mock-data";
import {
  PERIOD_SANKEY_CENTER_LABEL,
  type PeriodSankeyLinkTransaction,
  type PeriodSankeyData,
} from "@/lib/sankey-period";

type Props = {
  data: PeriodSankeyData;
  className?: string;
};

type HoverTip = {
  title: string;
  amount: string;
  clientX: number;
  clientY: number;
};

type DetailTip = {
  title: string;
  amount: string;
  transactions: PeriodSankeyLinkTransaction[];
};

type TreeNodePayload = {
  name?: string;
  value?: number;
};

type NodeRenderProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  payload: TreeNodePayload;
};

type LinkRenderProps = {
  sourceX: number;
  targetX: number;
  sourceY: number;
  targetY: number;
  sourceControlX: number;
  targetControlX: number;
  linkWidth: number;
  index: number;
  payload: {
    value?: number;
    source: TreeNodePayload;
    target: TreeNodePayload;
    transactions?: PeriodSankeyLinkTransaction[];
  };
};

function linkPathD(p: Pick<
  LinkRenderProps,
  | "sourceX"
  | "sourceY"
  | "sourceControlX"
  | "targetX"
  | "targetY"
  | "targetControlX"
>): string {
  return `M${p.sourceX},${p.sourceY} C${p.sourceControlX},${p.sourceY} ${p.targetControlX},${p.targetY} ${p.targetX},${p.targetY}`;
}

/**
 * Sankey Recharts: entrate (sinistra) → centro → uscite (destra).
 * Tooltip HTML fisso: il `<Tooltip>` di Recharts su Sankey + nodi custom spesso
 * non riceve hover sui `<g>`; qui intercettiamo sugli elementi SVG nativi.
 */
export default function PeriodSankeyChart({ data, className }: Props) {
  const [hover, setHover] = useState<HoverTip | null>(null);
  const [showTransactionsOnClick, setShowTransactionsOnClick] = useState(true);
  const [detail, setDetail] = useState<DetailTip | null>(null);

  const centerIdx = useMemo(
    () =>
      data.nodes.findIndex((n) => n.name === PERIOD_SANKEY_CENTER_LABEL),
    [data.nodes]
  );

  const chartData = useMemo(
    () => ({ nodes: data.nodes, links: data.links }),
    [data]
  );

  const nodeRenderer = useCallback(
    (props: NodeRenderProps) => {
      const cIdx = centerIdx >= 0 ? centerIdx : 0;
      const { x, y, width, height, index, payload } = props;
      let fill = "#64748b";
      if (index < cIdx) fill = "#3b82f6";
      else if (index > cIdx) fill = "#f59e0b";
      else fill = "#475569";

      const name = String(payload?.name ?? "").trim() || "Voce";
      const v = Number(payload?.value ?? 0);
      const amount = Number.isFinite(v) ? formatCurrency(v) : "—";

      return (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx={4}
          ry={4}
          fill={fill}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1}
          className="recharts-sankey-node"
          style={{ cursor: "default" }}
          onMouseEnter={(e) => {
            setHover({
              title: name,
              amount,
              clientX: e.clientX,
              clientY: e.clientY,
            });
          }}
          onMouseMove={(e) => {
            setHover((prev) =>
              prev
                ? {
                    ...prev,
                    clientX: e.clientX,
                    clientY: e.clientY,
                  }
                : null
            );
          }}
          onMouseLeave={() => setHover(null)}
        />
      );
    },
    [centerIdx]
  );

  const linkRenderer = useCallback(
    (props: LinkRenderProps) => {
      const {
        sourceX,
        targetX,
        sourceY,
        targetY,
        sourceControlX,
        targetControlX,
        linkWidth,
        payload,
      } = props;

      const sn = String(payload?.source?.name ?? "").trim();
      const tn = String(payload?.target?.name ?? "").trim();
      const title = sn && tn ? `${sn} → ${tn}` : sn || tn || "Flusso";
      const v = Number(payload?.value ?? 0);
      const amount = Number.isFinite(v) ? formatCurrency(v) : "—";

      const d = linkPathD({
        sourceX,
        sourceY,
        sourceControlX,
        targetX,
        targetY,
        targetControlX,
      });

      return (
        <path
          className="recharts-sankey-link"
          d={d}
          fill="none"
          stroke="rgba(96, 165, 250, 0.4)"
          strokeWidth={linkWidth}
          strokeOpacity={0.95}
          style={{ cursor: showTransactionsOnClick ? "pointer" : "default" }}
          onMouseEnter={(e) => {
            setHover({
              title,
              amount,
              clientX: e.clientX,
              clientY: e.clientY,
            });
          }}
          onMouseMove={(e) => {
            setHover((prev) =>
              prev
                ? {
                    ...prev,
                    clientX: e.clientX,
                    clientY: e.clientY,
                  }
                : null
            );
          }}
          onMouseLeave={() => setHover(null)}
          onClick={() => {
            if (!showTransactionsOnClick) return;
            setDetail({
              title,
              amount,
              transactions: payload?.transactions ?? [],
            });
          }}
        />
      );
    },
    [showTransactionsOnClick]
  );

  return (
    <div
      className={[
        "relative z-0 w-full shrink-0 overflow-visible",
        "h-[min(520px,72vh)] min-h-[360px] max-h-[640px]",
        className ?? "",
      ].join(" ")}
      onMouseLeave={() => setHover(null)}
    >
      <div className="mb-2 flex justify-end">
        <label className="inline-flex items-center gap-2 text-[11px] text-tremor-content-subtle">
          <input
            type="checkbox"
            checked={showTransactionsOnClick}
            onChange={(e) => {
              const next = e.target.checked;
              setShowTransactionsOnClick(next);
              if (!next) setDetail(null);
            }}
            className="h-3.5 w-3.5 accent-[color:var(--color-accent)]"
          />
          Click su un rivolo: dettagli transazioni
        </label>
      </div>

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
          link={linkRenderer}
        />
      </ResponsiveContainer>

      {hover ? (
        <div
          className="pointer-events-none fixed z-[200] max-w-[280px] rounded-xl border px-3 py-2 shadow-lg"
          style={{
            left: hover.clientX + 14,
            top: hover.clientY + 14,
            background: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
          }}
        >
          <p className="text-[11px] font-semibold leading-snug break-words">
            {hover.title}
          </p>
          <p className="mt-1 text-[13px] font-medium tabular-nums">{hover.amount}</p>
        </div>
      ) : null}

      {detail ? (
        <div
          className="absolute right-2 top-2 z-[220] w-[min(460px,calc(100%-1rem))] rounded-xl border p-3 shadow-lg"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold leading-snug break-words">
                {detail.title}
              </p>
              <p className="mt-1 text-[13px] font-medium tabular-nums">
                {detail.amount}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="rounded-md border px-2 py-1 text-[11px] hover:border-[color:var(--color-accent)]"
              style={{ borderColor: "var(--border)" }}
            >
              Chiudi
            </button>
          </div>

          <div className="mt-3 max-h-[260px] space-y-2 overflow-auto pr-1">
            {detail.transactions.length ? (
              detail.transactions.slice(0, 20).map((tx) => (
                <div
                  key={`${tx.id}-${tx.date}-${tx.amount}`}
                  className="rounded-lg border px-2.5 py-2"
                  style={{ borderColor: "var(--border)" }}
                >
                  <p className="text-[11px] font-medium leading-tight">
                    {tx.description}
                  </p>
                  <p className="mt-0.5 text-[10px] text-tremor-content-subtle">
                    {tx.date}
                    {tx.merchant ? ` · ${tx.merchant}` : ""}
                  </p>
                  <p className="mt-1 text-[12px] font-semibold tabular-nums">
                    {formatCurrency(tx.amount)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-tremor-content-subtle">
                Nessuna transazione disponibile per questo rivolo (puo essere un
                flusso sintetico di bilanciamento).
              </p>
            )}
          </div>
          {detail.transactions.length > 20 ? (
            <p className="mt-2 text-[10px] text-tremor-content-subtle">
              Mostrate le prime 20 transazioni.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
