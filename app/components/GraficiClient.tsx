"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { endOfDay, startOfDay } from "date-fns";
import ReactMarkdown from "react-markdown";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { AreaChart, Card, Grid, Metric, Text, Title } from "@tremor/react";
import DateRangePicker from "./DateRangePicker";
import GraficiChartTooltip, {
  type GraficiChartTooltipProps,
} from "./GraficiChartTooltip";
import MonthNavigator from "./MonthNavigator";
import PeriodSankeyChart from "./PeriodSankeyChart";
import WeeklyBurnLineChart from "./WeeklyBurnLineChart";
import {
  computeMonthlySummary,
  formatCurrency,
  percentDelta,
  type Transaction,
} from "@/lib/mock-data";
import {
  formatRangeLabel,
  getPreviousRange,
  isDateInRange,
  rangeToIsoBounds,
  type DateRange,
} from "@/lib/date-range";
import {
  buildCumulativeExpenseComparison,
  totalExpenseInRange,
} from "@/lib/cumulative-expense-chart";
import { aggregateExpenseByTag } from "@/lib/chart-aggregates";
import { fallbackInsightFromAggregates } from "@/lib/chart-insight-fallback";
import type { ChartInsightPayload } from "@/lib/gemini";
import {
  buildWeeklyBurnComparison,
  formatWeekRangeLabel,
  weeklyBurnDataStart,
  WEEKLY_BURN_DEFAULT_PREV_WEEKS,
} from "@/lib/weekly-burn-chart";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { fetchTransactionsBatched } from "@/lib/supabase-transactions-batched";
import { dateRangeFromIso } from "@/lib/default-month-range";
import {
  buildPeriodSankeyGrouped,
  collectTagsInRange,
  type SankeyGroupMode,
} from "@/lib/sankey-period";
import { normalizeTagLabel } from "@/lib/tag-colors";
import ChartAreaSkeleton from "./premium/ChartAreaSkeleton";
import SkeletonGlow from "./premium/SkeletonGlow";
import { useMinLoading } from "./premium/use-min-loading";

/** Colori espliciti (hex) per contrasto su sfondo scuro/chiaro — Tremor Area. */
const CHART_AREA_COLORS = ["#3b82f6", "#94a3b8"] as const;

const LS_SANKEY_MODE = "ff.grafici.sankeyMode";
const LS_SANKEY_PINS = "ff.grafici.sankeyPinnedTags";

function readSankeyPrefs(): { mode: SankeyGroupMode; pinnedTags: string[] } {
  if (typeof window === "undefined") {
    return { mode: "category", pinnedTags: [] };
  }
  try {
    const m = localStorage.getItem(LS_SANKEY_MODE);
    const mode: SankeyGroupMode = m === "tags" ? "tags" : "category";
    const raw = localStorage.getItem(LS_SANKEY_PINS);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const pinnedTags = Array.isArray(parsed)
      ? [
          ...new Set(
            parsed
              .filter((x): x is string => typeof x === "string")
              .map((x) => normalizeTagLabel(x))
              .filter(Boolean)
          ),
        ].sort((a, b) => a.localeCompare(b, "it"))
      : [];
    return { mode, pinnedTags };
  } catch {
    return { mode: "category", pinnedTags: [] };
  }
}

type Props = {
  defaultRangeIso: { fromIso: string; toIso: string };
  fallback?: Transaction[];
};

export default function GraficiClient({
  defaultRangeIso,
  fallback = [],
}: Props) {
  const configured = isSupabaseConfigured();
  const [transactions, setTransactions] = useState<Transaction[]>(fallback);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightMarkdown, setInsightMarkdown] = useState<string | null>(null);
  const [insightSource, setInsightSource] = useState<"gemini" | "fallback" | null>(
    null
  );
  const [dateRange, setDateRange] = useState<DateRange | null>(() =>
    dateRangeFromIso(defaultRangeIso)
  );

  const [sankeyMode, setSankeyMode] = useState<SankeyGroupMode>("category");
  const [sankeyPinnedTags, setSankeyPinnedTags] = useState<string[]>([]);
  const [sankeyPrefsHydrated, setSankeyPrefsHydrated] = useState(false);
  const [sankeyTagDraft, setSankeyTagDraft] = useState("");

  const loadingUi = useMinLoading(loading);
  const insightLoadingUi = useMinLoading(insightLoading);

  const rangeKey = dateRange
    ? `${dateRange.from.getTime()}|${(dateRange.to ?? dateRange.from).getTime()}`
    : "";

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseClient();
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const prev = dateRange ? getPreviousRange(dateRange) : null;
        if (!dateRange || !prev) {
          if (!cancelled) setTransactions([]);
          return;
        }
        const bounds = [dateRange, prev].map((r) => rangeToIsoBounds(r));
        let fromMs = Infinity;
        let toMs = -Infinity;
        for (const { fromIso, toIso } of bounds) {
          const a = new Date(fromIso).getTime();
          const b = new Date(toIso).getTime();
          fromMs = Math.min(fromMs, a);
          toMs = Math.max(toMs, b);
        }
        const refDay = startOfDay(dateRange.to ?? dateRange.from);
        const weekExtraFrom = weeklyBurnDataStart(
          refDay,
          WEEKLY_BURN_DEFAULT_PREV_WEEKS
        ).getTime();
        const weekExtraTo = endOfDay(refDay).getTime();
        fromMs = Math.min(fromMs, weekExtraFrom);
        toMs = Math.max(toMs, weekExtraTo);
        const fromIso = new Date(fromMs).toISOString();
        const toIso = new Date(toMs).toISOString();

        const data = await fetchTransactionsBatched(supabase, {
          dateFromIso: fromIso,
          dateToIso: toIso,
        });
        if (!cancelled) {
          setTransactions(data as Transaction[]);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Errore di caricamento");
          setTransactions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [configured, rangeKey]);

  const previousRange = useMemo(
    () => (dateRange ? getPreviousRange(dateRange) : null),
    [dateRange]
  );

  const chartData = useMemo(() => {
    if (!dateRange || !previousRange) return [];
    return buildCumulativeExpenseComparison(
      transactions,
      dateRange,
      previousRange
    );
  }, [transactions, dateRange, previousRange]);

  const expenseCur = useMemo(
    () => (dateRange ? totalExpenseInRange(transactions, dateRange) : 0),
    [transactions, dateRange]
  );

  const expensePrev = useMemo(
    () =>
      previousRange ? totalExpenseInRange(transactions, previousRange) : 0,
    [transactions, previousRange]
  );

  const deltaPct = useMemo(
    () => percentDelta(expenseCur, expensePrev),
    [expenseCur, expensePrev]
  );

  const summaryCur = useMemo(() => {
    if (!dateRange) return null;
    const rows = transactions.filter((t) => isDateInRange(t.date, dateRange));
    return computeMonthlySummary(rows);
  }, [transactions, dateRange]);

  const referenceDayForWeek = useMemo(
    () => (dateRange ? startOfDay(dateRange.to ?? dateRange.from) : null),
    [dateRange]
  );

  const weeklyChartData = useMemo(() => {
    if (!referenceDayForWeek) return [];
    return buildWeeklyBurnComparison(
      transactions,
      referenceDayForWeek,
      WEEKLY_BURN_DEFAULT_PREV_WEEKS
    );
  }, [transactions, referenceDayForWeek]);

  const tagsInPeriodForSankey = useMemo(() => {
    if (!dateRange) return [];
    return collectTagsInRange(transactions, dateRange);
  }, [transactions, dateRange]);

  const sankeyData = useMemo(() => {
    if (!dateRange) return null;
    return buildPeriodSankeyGrouped(transactions, dateRange, {
      mode: sankeyMode,
      pinnedTags: sankeyPinnedTags,
    });
  }, [transactions, dateRange, sankeyMode, sankeyPinnedTags]);

  const toggleSankeyTag = useCallback((tag: string) => {
    const n = normalizeTagLabel(tag);
    if (!n) return;
    setSankeyPinnedTags((prev) =>
      prev.includes(n)
        ? prev.filter((x) => x !== n)
        : [...prev, n].sort((a, b) => a.localeCompare(b, "it"))
    );
  }, []);

  const addSankeyTagFromDraft = useCallback(() => {
    const n = normalizeTagLabel(sankeyTagDraft);
    if (!n) return;
    setSankeyPinnedTags((prev) =>
      prev.includes(n)
        ? prev
        : [...prev, n].sort((a, b) => a.localeCompare(b, "it"))
    );
    setSankeyTagDraft("");
  }, [sankeyTagDraft]);

  const insightPayload = useMemo((): ChartInsightPayload | null => {
    if (!dateRange || !previousRange) return null;
    const top = aggregateExpenseByTag(transactions, dateRange, {
      maxTags: 12,
    }).map((r) => ({
      tag: r.tag,
      amount: r.amount,
      sharePct: r.sharePct,
    }));
    const lastWeekly = weeklyChartData[weeklyChartData.length - 1];
    const weeklyBurn =
      lastWeekly && referenceDayForWeek
        ? {
            weekLabel: formatWeekRangeLabel(referenceDayForWeek),
            spendCumulativeEnd: lastWeekly.corrente,
            avgPreviousWeeksCumulativeEnd: lastWeekly.mediaPrecedenti,
          }
        : undefined;
    return {
      periodCurrentLabel: formatRangeLabel(dateRange),
      periodPreviousLabel: formatRangeLabel(previousRange),
      expenseCurrent: expenseCur,
      expensePrevious: expensePrev,
      expenseDeltaPct: deltaPct,
      topTagsCurrent: top,
      ...(weeklyBurn ? { weeklyBurn } : {}),
    };
  }, [
    dateRange,
    previousRange,
    transactions,
    expenseCur,
    expensePrev,
    deltaPct,
    weeklyChartData,
    referenceDayForWeek,
  ]);

  const localFallbackInsight = useMemo(() => {
    if (!insightPayload) return null;
    return fallbackInsightFromAggregates(insightPayload);
  }, [insightPayload]);

  useEffect(() => {
    setInsightMarkdown(null);
    setInsightSource(null);
    setInsightLoading(false);
  }, [rangeKey]);

  useEffect(() => {
    const p = readSankeyPrefs();
    setSankeyMode(p.mode);
    setSankeyPinnedTags(p.pinnedTags);
    setSankeyPrefsHydrated(true);
  }, []);

  useEffect(() => {
    if (!sankeyPrefsHydrated || typeof window === "undefined") return;
    try {
      localStorage.setItem(LS_SANKEY_MODE, sankeyMode);
      localStorage.setItem(LS_SANKEY_PINS, JSON.stringify(sankeyPinnedTags));
    } catch {
      /* ignore */
    }
  }, [sankeyPrefsHydrated, sankeyMode, sankeyPinnedTags]);

  const cumulativeTooltip = useCallback(
    (props: { active?: boolean; payload?: unknown[]; label?: unknown }) => (
      <GraficiChartTooltip
        active={props.active}
        payload={props.payload as GraficiChartTooltipProps["payload"]}
        label={props.label}
        variant="cumulative"
      />
    ),
    []
  );

  const handleGenerateInsight = useCallback(async () => {
    if (!insightPayload) return;
    if (!configured) {
      setInsightMarkdown(fallbackInsightFromAggregates(insightPayload));
      setInsightSource("fallback");
      return;
    }
    setInsightLoading(true);
    setInsightSource(null);
    try {
      const resp = await fetch("/api/chart-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(insightPayload),
      });
      const json = (await resp.json()) as {
        insight?: string;
        source?: "gemini" | "fallback";
      };
      if (!resp.ok || typeof json.insight !== "string" || !json.insight) {
        setInsightMarkdown(fallbackInsightFromAggregates(insightPayload));
        setInsightSource("fallback");
      } else {
        setInsightMarkdown(json.insight);
        setInsightSource(json.source === "gemini" ? "gemini" : "fallback");
      }
    } catch {
      setInsightMarkdown(fallbackInsightFromAggregates(insightPayload));
      setInsightSource("fallback");
    } finally {
      setInsightLoading(false);
    }
  }, [configured, insightPayload]);

  return (
    <div className="grafici-charts space-y-6">
      {!configured ? (
        <div className="card-surface flex items-start gap-3 p-4 text-[13px]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--color-accent)]" />
          <p className="text-[color:var(--color-muted-foreground)]">
            Supabase non configurato: i grafici usano i dati di esempio; cambia
            il periodo per vedere come si muove la curva.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="card-surface flex items-start gap-3 border-[color:var(--color-expense)]/30 p-4 text-[13px] text-[color:var(--color-expense)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <MonthNavigator value={dateRange} onChange={setDateRange} />
        <DateRangePicker value={dateRange} onChange={setDateRange} />
      </div>

      <Grid numItemsMd={2} className="gap-4">
        <Card decoration="top" decorationColor="blue">
          <Text>Uscite nel periodo</Text>
          <Metric>{formatCurrency(expenseCur)}</Metric>
          <Text className="mt-1 text-tremor-content-subtle">
            {dateRange ? formatRangeLabel(dateRange) : "—"}
          </Text>
        </Card>
        <Card decoration="top" decorationColor="slate">
          <Text>Periodo precedente (stessa lunghezza)</Text>
          <Metric>{formatCurrency(expensePrev)}</Metric>
          <Text className="mt-1 text-tremor-content-subtle">
            {previousRange ? formatRangeLabel(previousRange) : "—"}
            {deltaPct != null ? (
              <>
                {" "}
                ·{" "}
                <span
                  className={
                    deltaPct > 0
                      ? "text-red-600 dark:text-red-400"
                      : deltaPct < 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : ""
                  }
                >
                  {deltaPct > 0 ? "+" : ""}
                  {deltaPct.toFixed(1)}% vs precedente
                </span>
              </>
            ) : null}
          </Text>
        </Card>
      </Grid>

      <Card>
        <Title>Spesa cumulativa</Title>
        <Text className="mt-1">
          Confronto tra il periodo selezionato e quello immediatamente precedente
          con la stessa durata. Solo uscite reali (importi negativi), giroconti
          esclusi. In legenda:{" "}
          <span className="font-medium">corrente</span> = periodo scelto,{" "}
          <span className="font-medium">precedente</span> = periodo a parità di
          giorni prima.
        </Text>
        {loadingUi ? (
          <ChartAreaSkeleton className="mt-8 py-2" />
        ) : chartData.length === 0 ? (
          <p className="mt-6 text-[13px] text-tremor-content-subtle">
            Nessun dato nel range selezionato.
          </p>
        ) : (
          <AreaChart
            className="mt-6 h-80"
            data={chartData}
            index="giorno"
            categories={["corrente", "precedente"]}
            colors={[...CHART_AREA_COLORS]}
            valueFormatter={(v) => formatCurrency(v)}
            customTooltip={cumulativeTooltip}
            showLegend
            curveType="monotone"
            yAxisWidth={72}
          />
        )}
      </Card>

      <Card>
        <Title>Burn rate settimanale</Title>
        <Text className="mt-1">
          Settimana ISO (lun–dom) che contiene l&apos;ultimo giorno del periodo
          selezionato: spesa cumulativa giorno per giorno rispetto alla{" "}
          <span className="font-medium">media</span> allo stesso punto nelle{" "}
          {WEEKLY_BURN_DEFAULT_PREV_WEEKS} settimane precedenti. Solo uscite,
          giroconti esclusi. Se il periodo finisce a metà settimana, il
          confronto si ferma a quel giorno (apples-to-apples).
        </Text>
        {referenceDayForWeek ? (
          <Text className="mt-2 text-[12px] text-tremor-content-subtle">
            Settimana di riferimento: {formatWeekRangeLabel(referenceDayForWeek)}{" "}
            · giorno limite:{" "}
            {referenceDayForWeek.toLocaleDateString("it-IT", {
              weekday: "long",
              day: "numeric",
              month: "short",
            })}
          </Text>
        ) : null}
        {loadingUi ? (
          <ChartAreaSkeleton className="mt-8 py-2" />
        ) : weeklyChartData.length === 0 ? (
          <p className="mt-6 text-[13px] text-tremor-content-subtle">
            Nessun dato per il confronto settimanale nel range caricato.
          </p>
        ) : (
          <WeeklyBurnLineChart data={weeklyChartData} className="mt-6 h-80 w-full" />
        )}
      </Card>

      <Card className="overflow-visible">
        <Title>Flusso entrate → uscite (Sankey)</Title>
        <Text className="mt-1">
          {sankeyMode === "category"
            ? "Nel periodo: entrate e uscite per categoria (sinistra / destra), nodo centrale di riepilogo."
            : "Nel periodo: entrate e uscite ripartite sui tag che scegli sotto. Se una transazione ha più tag selezionati, l’importo è diviso in parti uguali tra essi. I movimenti senza nessuno di quei tag finiscono in “Fuori dai tag scelti”."}{" "}
          Giroconti esclusi. Se entrate e uscite non coincidono, compaiono voci
          di bilanciamento (&quot;Copertura oltre le entrate&quot; o &quot;Avanzo
          non speso&quot;). Passa il mouse su collegamenti e rettangoli per gli
          importi.
        </Text>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium text-tremor-content-subtle">
            Aggrega per
          </span>
          <div className="inline-flex rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 p-0.5">
            <button
              type="button"
              onClick={() => setSankeyMode("category")}
              className={[
                "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                sankeyMode === "category"
                  ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-sm"
                  : "text-tremor-content-subtle hover:text-[color:var(--color-foreground)]",
              ].join(" ")}
            >
              Categorie
            </button>
            <button
              type="button"
              onClick={() => setSankeyMode("tags")}
              className={[
                "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                sankeyMode === "tags"
                  ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-sm"
                  : "text-tremor-content-subtle hover:text-[color:var(--color-foreground)]",
              ].join(" ")}
            >
              Tag
            </button>
          </div>
        </div>

        {sankeyMode === "tags" ? (
          <div className="mt-3 space-y-3 rounded-xl border border-[color:var(--color-border)] border-dashed bg-[color:var(--color-surface-muted)]/30 p-4">
            <Text className="!text-[12px] text-tremor-content-subtle">
              Clicca i tag presenti nel periodo per attivarli, oppure aggiungi un
              nome a mano. La scelta resta salvata in questo browser.
            </Text>
            {tagsInPeriodForSankey.length ? (
              <div className="flex flex-wrap gap-1.5">
                {tagsInPeriodForSankey.map((tag) => {
                  const on = sankeyPinnedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleSankeyTag(tag)}
                      className={[
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                        on
                          ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)]"
                          : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-tremor-content-subtle hover:border-[color:var(--color-accent)]/50",
                      ].join(" ")}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[12px] text-tremor-content-subtle">
                Nessun tag nelle transazioni di questo periodo: usa il campo qui
                sotto per aggiungerne uno lo stesso.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={sankeyTagDraft}
                onChange={(e) => setSankeyTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSankeyTagFromDraft();
                  }
                }}
                placeholder="Aggiungi tag (Invio)"
                className="h-9 min-w-[160px] flex-1 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 text-[12px] outline-none focus:border-[color:var(--color-accent)]"
              />
              <button
                type="button"
                onClick={addSankeyTagFromDraft}
                className="h-9 shrink-0 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[12px] font-medium text-[color:var(--color-foreground)] hover:border-[color:var(--color-accent)]"
              >
                Aggiungi
              </button>
              {sankeyPinnedTags.length ? (
                <button
                  type="button"
                  onClick={() => setSankeyPinnedTags([])}
                  className="h-9 shrink-0 text-[12px] font-medium text-tremor-content-subtle hover:text-[color:var(--color-expense)]"
                >
                  Svuota lista
                </button>
              ) : null}
            </div>
            {sankeyPinnedTags.length ? (
              <p className="text-[11px] text-tremor-content-subtle">
                Attivi ({sankeyPinnedTags.length}):{" "}
                <span className="font-medium text-[color:var(--color-foreground)]">
                  {sankeyPinnedTags.join(", ")}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        {loadingUi ? (
          <div className="mt-8 flex min-h-[280px] flex-col justify-center gap-4 py-4">
            <SkeletonGlow className="h-4 w-48 max-w-full rounded-md" />
            <SkeletonGlow className="min-h-[220px] w-full flex-1 rounded-2xl border border-zinc-800/15 dark:border-zinc-800/35" />
          </div>
        ) : sankeyMode === "tags" && sankeyPinnedTags.length === 0 ? (
          <p className="mt-6 text-[13px] text-tremor-content-subtle">
            Seleziona almeno un tag (o aggiungine uno a mano) per costruire il
            Sankey in vista Tag.
          </p>
        ) : !sankeyData ? (
          <p className="mt-6 text-[13px] text-tremor-content-subtle">
            Nessun movimento nel periodo per costruire il Sankey.
          </p>
        ) : (
          <PeriodSankeyChart data={sankeyData} className="mt-4 w-full" />
        )}
      </Card>

      {insightPayload ? (
        <Card>
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--color-accent)]" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <Title>Insight (solo aggregati)</Title>
                  <Text className="mt-1">
                    Sintesi su totali e ripartizione per{" "}
                    <span className="font-medium">tag</span> del periodo (nessun
                    movimento singolo inviato al modello). Non è consulenza
                    finanziaria.
                  </Text>
                </div>
                <button
                  type="button"
                  onClick={() => void handleGenerateInsight()}
                  disabled={insightLoading || loading}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-[color:var(--color-border)] px-4 py-2 text-[12.5px] font-medium transition-colors hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {insightLoadingUi ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Genera insight
                </button>
              </div>
              <Text className="mt-2 text-[11px] text-tremor-content-subtle">
                L&apos;insight non parte da solo al cambio date: usa il pulsante
                quando vuoi aggiornarlo.
              </Text>
              {insightLoadingUi ? (
                <div className="mt-4 flex items-center gap-2 text-[13px] text-tremor-content-subtle">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generazione in corso…
                </div>
              ) : insightMarkdown ? (
                <div className="mt-4 space-y-2 text-[13px] leading-relaxed text-[color:var(--color-foreground)] [&_strong]:font-semibold [&_p]:my-1 [&_ul]:my-1 [&_li]:ml-4">
                  <ReactMarkdown>{insightMarkdown}</ReactMarkdown>
                </div>
              ) : (
                <p className="mt-4 text-[13px] text-tremor-content-subtle">
                  {configured
                    ? "Clicca «Genera insight» per una sintesi AI sui dati del periodo selezionato."
                    : "Clicca «Genera insight» per la sintesi locale (demo, senza server)."}
                </p>
              )}
              {!insightLoadingUi && insightSource ? (
                <Text className="mt-2 text-[11px] text-tremor-content-subtle">
                  Fonte: {insightSource === "gemini" ? "Gemini" : "regole locali"}
                </Text>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {summaryCur ? (
        <Card>
          <Title>Riepilogo periodo (tutti i movimenti)</Title>
          <Text className="mt-1">
            Entrate e uscite nel periodo selezionato (giroconti esclusi dai
            totali).
          </Text>
          <Grid numItemsMd={3} className="mt-4 gap-4">
            <div>
              <Text>Entrate</Text>
              <Metric className="text-emerald-600 dark:text-emerald-400">
                {formatCurrency(summaryCur.income)}
              </Metric>
            </div>
            <div>
              <Text>Uscite</Text>
              <Metric className="text-red-600 dark:text-red-400">
                {formatCurrency(summaryCur.expenses)}
              </Metric>
            </div>
            <div>
              <Text>Cashflow netto</Text>
              <Metric>{formatCurrency(summaryCur.balance)}</Metric>
            </div>
          </Grid>
        </Card>
      ) : null}
    </div>
  );
}
