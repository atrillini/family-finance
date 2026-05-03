"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  endOfDay,
  endOfMonth,
  getISOWeek,
  getISOWeekYear,
  startOfDay,
  startOfMonth,
  subMonths,
  subWeeks,
} from "date-fns";
import { AlertCircle, Loader2 } from "lucide-react";
import { Card, Text, Title } from "@tremor/react";
import DateRangePicker from "./DateRangePicker";
import PeriodSankeyChart from "./PeriodSankeyChart";
import ChartAreaSkeleton from "./premium/ChartAreaSkeleton";
import SkeletonGlow from "./premium/SkeletonGlow";
import { useMinLoading } from "./premium/use-min-loading";
import { formatCurrency, type Transaction } from "@/lib/mock-data";
import {
  formatRangeLabel,
  rangeToIsoBounds,
  type DateRange,
} from "@/lib/date-range";
import { isoWeekYearNumberToRange } from "@/lib/iso-week-range";
import { dateRangeFromIso } from "@/lib/default-month-range";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { fetchTransactionsBatched } from "@/lib/supabase-transactions-batched";
import {
  buildPeriodSankeyGrouped,
  collectTagsInRange,
} from "@/lib/sankey-period";
import { normalizeTagLabel } from "@/lib/tag-colors";
import {
  summarizeTaggedFlows,
  deltaPctRefToCmp,
  formatDeltaPctIt,
} from "@/lib/tag-set-analysis";
import { isTransactionVisible } from "@/lib/transaction-visibility";

const LS_ANALISI_TAGS = "ff.analisiTag.tags";

type PeriodMode = "month" | "week" | "custom";

function mergedEnvelope(a: DateRange, b: DateRange): DateRange {
  const from = startOfDay(
    new Date(Math.min(a.from.getTime(), b.from.getTime()))
  );
  const aTo = a.to ?? a.from;
  const bTo = b.to ?? b.from;
  const to = endOfDay(
    new Date(Math.max(aTo.getTime(), bTo.getTime()))
  );
  return { from, to };
}

function monthInputToRange(ym: string): DateRange | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  const first = startOfMonth(new Date(y, mo, 1));
  const last = endOfMonth(first);
  return { from: startOfDay(first), to: endOfDay(last) };
}

function formatMonthInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

type Props = {
  defaultRangeIso: { fromIso: string; toIso: string };
  fallback?: Transaction[];
};

export default function AnalisiTagClient({
  defaultRangeIso,
  fallback = [],
}: Props) {
  const configured = isSupabaseConfigured();
  const [transactions, setTransactions] = useState<Transaction[]>(fallback);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);

  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const today = useMemo(() => startOfDay(new Date()), []);

  const [monthRefYm, setMonthRefYm] = useState(() =>
    formatMonthInputValue(subMonths(today, 1))
  );
  const [monthCmpYm, setMonthCmpYm] = useState(() =>
    formatMonthInputValue(today)
  );

  const [weekRefYear, setWeekRefYear] = useState(() => {
    const d = subWeeks(today, 1);
    return getISOWeekYear(d);
  });
  const [weekRefNum, setWeekRefNum] = useState(() => getISOWeek(subWeeks(today, 1)));
  const [weekCmpYear, setWeekCmpYear] = useState(() => getISOWeekYear(today));
  const [weekCmpNum, setWeekCmpNum] = useState(() => getISOWeek(today));

  const [customRef, setCustomRef] = useState<DateRange | null>(() => {
    const prev = subMonths(today, 1);
    return {
      from: startOfDay(startOfMonth(prev)),
      to: endOfDay(endOfMonth(prev)),
    };
  });
  const [customCmp, setCustomCmp] = useState<DateRange | null>(() =>
    dateRangeFromIso(defaultRangeIso)
  );

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [tagPrefsHydrated, setTagPrefsHydrated] = useState(false);
  const [sankeyPeriod, setSankeyPeriod] = useState<"ref" | "cmp">("ref");

  const loadingUi = useMinLoading(loading);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(LS_ANALISI_TAGS);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) {
        const next = [
          ...new Set(
            parsed
              .filter((x): x is string => typeof x === "string")
              .map((x) => normalizeTagLabel(x))
              .filter(Boolean)
          ),
        ].sort((a, b) => a.localeCompare(b, "it"));
        setSelectedTags(next);
      }
    } catch {
      /* ignore */
    }
    setTagPrefsHydrated(true);
  }, []);

  useEffect(() => {
    if (!tagPrefsHydrated) return;
    try {
      localStorage.setItem(LS_ANALISI_TAGS, JSON.stringify(selectedTags));
    } catch {
      /* ignore */
    }
  }, [selectedTags, tagPrefsHydrated]);

  const refRange = useMemo((): DateRange | null => {
    if (periodMode === "month") {
      return monthInputToRange(monthRefYm);
    }
    if (periodMode === "week") {
      return isoWeekYearNumberToRange(weekRefYear, weekRefNum);
    }
    return customRef;
  }, [periodMode, monthRefYm, weekRefYear, weekRefNum, customRef]);

  const cmpRange = useMemo((): DateRange | null => {
    if (periodMode === "month") {
      return monthInputToRange(monthCmpYm);
    }
    if (periodMode === "week") {
      return isoWeekYearNumberToRange(weekCmpYear, weekCmpNum);
    }
    return customCmp;
  }, [periodMode, monthCmpYm, weekCmpYear, weekCmpNum, customCmp]);

  const envelopeRange = useMemo(() => {
    if (!refRange || !cmpRange) return null;
    return mergedEnvelope(refRange, cmpRange);
  }, [refRange, cmpRange]);

  const envelopeKey = useMemo(() => {
    if (!envelopeRange) return "";
    const b = rangeToIsoBounds(envelopeRange);
    return `${b.fromIso}|${b.toIso}`;
  }, [envelopeRange]);

  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseClient();
    let cancelled = false;

    async function load() {
      if (!envelopeRange) {
        if (!cancelled) {
          setTransactions([]);
          setLoading(false);
          setError(null);
        }
        return;
      }
      setLoading(true);
      try {
        const b = rangeToIsoBounds(envelopeRange);
        const data = await fetchTransactionsBatched(supabase, {
          dateFromIso: b.fromIso,
          dateToIso: b.toIso,
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
  }, [configured, envelopeKey, envelopeRange]);

  const visibleTransactions = useMemo(
    () => transactions.filter(isTransactionVisible),
    [transactions]
  );

  const tagsInEnvelope = useMemo(
    () =>
      envelopeRange
        ? collectTagsInRange(visibleTransactions, envelopeRange)
        : [],
    [visibleTransactions, envelopeRange]
  );

  const refTotals = useMemo(() => {
    if (!refRange || selectedTags.length === 0) {
      return { income: 0, expense: 0 };
    }
    return summarizeTaggedFlows(visibleTransactions, refRange, selectedTags);
  }, [visibleTransactions, refRange, selectedTags]);

  const cmpTotals = useMemo(() => {
    if (!cmpRange || selectedTags.length === 0) {
      return { income: 0, expense: 0 };
    }
    return summarizeTaggedFlows(visibleTransactions, cmpRange, selectedTags);
  }, [visibleTransactions, cmpRange, selectedTags]);

  const refNet = refTotals.income - refTotals.expense;
  const cmpNet = cmpTotals.income - cmpTotals.expense;

  const sankeyRange = sankeyPeriod === "ref" ? refRange : cmpRange;
  const sankeyData = useMemo(() => {
    if (!sankeyRange || selectedTags.length === 0) return null;
    return buildPeriodSankeyGrouped(visibleTransactions, sankeyRange, {
      mode: "tags",
      pinnedTags: selectedTags,
    });
  }, [visibleTransactions, sankeyRange, selectedTags]);

  const toggleTag = useCallback((tag: string) => {
    const n = normalizeTagLabel(tag);
    if (!n) return;
    setSelectedTags((prev) =>
      prev.includes(n) ? prev.filter((t) => t !== n) : [...prev, n].sort((a, b) => a.localeCompare(b, "it"))
    );
  }, []);

  const addTagFromDraft = useCallback(() => {
    const n = normalizeTagLabel(tagDraft);
    if (!n) return;
    setSelectedTags((prev) =>
      prev.includes(n) ? prev : [...prev, n].sort((a, b) => a.localeCompare(b, "it"))
    );
    setTagDraft("");
  }, [tagDraft]);

  const invalidWeek =
    periodMode === "week" &&
    (!refRange || !cmpRange);

  const pctCls = useCallback(
    (kind: "income" | "expense" | "net", ref: number, cmp: number) => {
      if (ref === cmp) return "";
      const up = cmp > ref;
      if (kind === "income") {
        return up
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400";
      }
      if (kind === "expense") {
        return up
          ? "text-red-600 dark:text-red-400"
          : "text-emerald-600 dark:text-emerald-400";
      }
      return up
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";
    },
    []
  );

  const modeBtn = useCallback((m: PeriodMode, label: string) => {
    const on = periodMode === m;
    return (
      <button
        key={m}
        type="button"
        onClick={() => setPeriodMode(m)}
        className={[
          "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
          on
            ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-sm"
            : "text-tremor-content-subtle hover:text-[color:var(--color-foreground)]",
        ].join(" ")}
      >
        {label}
      </button>
    );
  }, [periodMode]);

  return (
    <div className="space-y-6">
      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-[13px] text-red-700 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <Card>
        <Title>Tag</Title>
        <Text className="mt-1">
          Scegli uno o più tag da analizzare. Se una transazione ha più tag tra
          quelli selezionati, l&apos;importo è diviso in parti uguali (come nel
          Sankey per-tag).
        </Text>
        <div className="mt-4 space-y-3 rounded-xl border border-[color:var(--color-border)] border-dashed bg-[color:var(--color-surface-muted)]/30 p-4">
          {tagsInEnvelope.length ? (
            <div className="flex flex-wrap gap-1.5">
              {tagsInEnvelope.map((tag) => {
                const on = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
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
              {loadingUi
                ? "Caricamento tag…"
                : "Nessun tag nel periodo caricato: puoi aggiungerne uno sotto."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTagFromDraft();
                }
              }}
              placeholder="Aggiungi tag (Invio)"
              className="h-9 min-w-[160px] flex-1 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 text-[12px] outline-none focus:border-[color:var(--color-accent)]"
            />
            <button
              type="button"
              onClick={addTagFromDraft}
              className="h-9 shrink-0 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[12px] font-medium text-[color:var(--color-foreground)] hover:border-[color:var(--color-accent)]"
            >
              Aggiungi
            </button>
            {selectedTags.length ? (
              <button
                type="button"
                onClick={() => setSelectedTags([])}
                className="h-9 shrink-0 text-[12px] font-medium text-tremor-content-subtle hover:text-[color:var(--color-expense)]"
              >
                Svuota lista
              </button>
            ) : null}
          </div>
        </div>
        {selectedTags.length === 0 ? (
          <p className="mt-3 text-[12px] font-medium text-amber-700 dark:text-amber-300">
            Seleziona almeno un tag per vedere i totali e il Sankey.
          </p>
        ) : null}
      </Card>

      <Card>
        <Title>Periodi</Title>
        <Text className="mt-1">
          Confronto tra periodo di riferimento e periodo di confronto. Per le
          settimane si usa la numerazione ISO (lun–dom).
        </Text>
        <div className="mt-4 inline-flex flex-wrap rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 p-0.5">
          {modeBtn("month", "Mese")}
          {modeBtn("week", "Settimana ISO")}
          {modeBtn("custom", "Date libere")}
        </div>

        {periodMode === "month" ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-[12px] font-medium text-tremor-content-subtle">
                Riferimento
              </span>
              <input
                type="month"
                value={monthRefYm}
                onChange={(e) => setMonthRefYm(e.target.value)}
                className="h-10 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 text-[13px]"
              />
              <span className="text-[11px] text-tremor-content-subtle">
                {refRange ? formatRangeLabel(refRange) : "—"}
              </span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[12px] font-medium text-tremor-content-subtle">
                Confronto
              </span>
              <input
                type="month"
                value={monthCmpYm}
                onChange={(e) => setMonthCmpYm(e.target.value)}
                className="h-10 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2.5 text-[13px]"
              />
              <span className="text-[11px] text-tremor-content-subtle">
                {cmpRange ? formatRangeLabel(cmpRange) : "—"}
              </span>
            </label>
          </div>
        ) : null}

        {periodMode === "week" ? (
          <div className="mt-4 space-y-4">
            {invalidWeek ? (
              <p className="text-[12px] text-red-600 dark:text-red-400">
                Anno e settimana ISO non validi per almeno uno dei due periodi.
                Prova un numero di settimana tra 1 e 52/53 valido per quell&apos;anno.
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 rounded-xl border border-[color:var(--color-border)] p-3">
                <p className="text-[12px] font-medium text-tremor-content-subtle">
                  Riferimento
                </p>
                <div className="flex flex-wrap gap-2">
                  <label className="flex flex-col gap-1 text-[11px] text-tremor-content-subtle">
                    Anno ISO
                    <input
                      type="number"
                      value={weekRefYear}
                      onChange={(e) =>
                        setWeekRefYear(clampInt(Number(e.target.value), 1970, 2100))
                      }
                      className="h-9 w-[100px] rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 text-[13px]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-tremor-content-subtle">
                    Settimana
                    <input
                      type="number"
                      min={1}
                      max={53}
                      value={weekRefNum}
                      onChange={(e) =>
                        setWeekRefNum(clampInt(Number(e.target.value), 1, 53))
                      }
                      className="h-9 w-[72px] rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 text-[13px]"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-tremor-content-subtle">
                  {refRange ? formatRangeLabel(refRange) : "—"}
                </p>
              </div>
              <div className="space-y-2 rounded-xl border border-[color:var(--color-border)] p-3">
                <p className="text-[12px] font-medium text-tremor-content-subtle">
                  Confronto
                </p>
                <div className="flex flex-wrap gap-2">
                  <label className="flex flex-col gap-1 text-[11px] text-tremor-content-subtle">
                    Anno ISO
                    <input
                      type="number"
                      value={weekCmpYear}
                      onChange={(e) =>
                        setWeekCmpYear(clampInt(Number(e.target.value), 1970, 2100))
                      }
                      className="h-9 w-[100px] rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 text-[13px]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-tremor-content-subtle">
                    Settimana
                    <input
                      type="number"
                      min={1}
                      max={53}
                      value={weekCmpNum}
                      onChange={(e) =>
                        setWeekCmpNum(clampInt(Number(e.target.value), 1, 53))
                      }
                      className="h-9 w-[72px] rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 text-[13px]"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-tremor-content-subtle">
                  {cmpRange ? formatRangeLabel(cmpRange) : "—"}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {periodMode === "custom" ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <span className="text-[12px] font-medium text-tremor-content-subtle">
                Riferimento
              </span>
              <DateRangePicker value={customRef} onChange={setCustomRef} />
            </div>
            <div className="space-y-2">
              <span className="text-[12px] font-medium text-tremor-content-subtle">
                Confronto
              </span>
              <DateRangePicker value={customCmp} onChange={setCustomCmp} />
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <Title>Totali attribuiti al set di tag</Title>
        <Text className="mt-1 text-tremor-content-subtle">
          Giroconti esclusi; transazioni nascoste escluse. Le percentuali
          confrontano il periodo di confronto rispetto al riferimento:{" "}
          <span className="font-medium">(confronto − riferimento) / riferimento</span>
          . Se il riferimento è 0 e il confronto no, mostriamo{" "}
          <span className="font-medium">Nuovo</span>.
        </Text>
        {loadingUi && selectedTags.length > 0 ? (
          <div className="mt-6 space-y-3">
            <SkeletonGlow className="h-10 w-full rounded-lg" />
            <SkeletonGlow className="h-10 w-full rounded-lg" />
            <SkeletonGlow className="h-10 w-full rounded-lg" />
          </div>
        ) : selectedTags.length === 0 || invalidWeek ? null : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-tremor-content-subtle">
                  <th className="py-2 pr-3 font-medium">Voce</th>
                  <th className="py-2 pr-3 font-medium">Riferimento</th>
                  <th className="py-2 pr-3 font-medium">Confronto</th>
                  <th className="py-2 pr-3 font-medium">Δ</th>
                  <th className="py-2 font-medium">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    {
                      label: "Entrate",
                      ref: refTotals.income,
                      cmp: cmpTotals.income,
                      kind: "income" as const,
                    },
                    {
                      label: "Uscite",
                      ref: refTotals.expense,
                      cmp: cmpTotals.expense,
                      kind: "expense" as const,
                    },
                    {
                      label: "Netto",
                      ref: refNet,
                      cmp: cmpNet,
                      kind: "net" as const,
                    },
                  ] as const
                ).map((row) => {
                  const dAbs = row.cmp - row.ref;
                  const dPct = deltaPctRefToCmp(row.ref, row.cmp);
                  return (
                    <tr
                      key={row.label}
                      className="border-b border-[color:var(--color-border)]/60"
                    >
                      <td className="py-2.5 pr-3 font-medium">{row.label}</td>
                      <td className="py-2.5 pr-3 tabular-nums">
                        {formatCurrency(row.ref)}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">
                        {formatCurrency(row.cmp)}
                      </td>
                      <td
                        className={[
                          "py-2.5 pr-3 tabular-nums font-medium",
                          pctCls(row.kind, row.ref, row.cmp),
                        ].join(" ")}
                      >
                        {dAbs === 0
                          ? formatCurrency(0)
                          : `${dAbs > 0 ? "+" : "-"}${formatCurrency(Math.abs(dAbs))}`}
                      </td>
                      <td
                        className={[
                          "py-2.5 tabular-nums font-medium",
                          pctCls(row.kind, row.ref, row.cmp),
                        ].join(" ")}
                      >
                        {formatDeltaPctIt(dPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-visible">
        <Title>Sankey (stesso set di tag)</Title>
        <Text className="mt-1">
          Stessa aggregazione dei grafici: passa tra riferimento e confronto per
          il flusso entrate/uscite sui tag selezionati.
        </Text>
        <div className="mt-3 inline-flex rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 p-0.5">
          <button
            type="button"
            onClick={() => setSankeyPeriod("ref")}
            className={[
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
              sankeyPeriod === "ref"
                ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-sm"
                : "text-tremor-content-subtle hover:text-[color:var(--color-foreground)]",
            ].join(" ")}
          >
            Riferimento
          </button>
          <button
            type="button"
            onClick={() => setSankeyPeriod("cmp")}
            className={[
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
              sankeyPeriod === "cmp"
                ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-sm"
                : "text-tremor-content-subtle hover:text-[color:var(--color-foreground)]",
            ].join(" ")}
          >
            Confronto
          </button>
        </div>
        {sankeyRange ? (
          <p className="mt-2 text-[11px] text-tremor-content-subtle">
            {formatRangeLabel(sankeyRange)}
          </p>
        ) : null}
        {loadingUi && selectedTags.length > 0 ? (
          <ChartAreaSkeleton className="mt-6 py-2" />
        ) : selectedTags.length === 0 || invalidWeek ? (
          <p className="mt-6 text-[13px] text-tremor-content-subtle">
            {selectedTags.length === 0
              ? "Seleziona almeno un tag per il Sankey."
              : "Periodo non valido."}
          </p>
        ) : !sankeyData ? (
          <p className="mt-6 text-[13px] text-tremor-content-subtle">
            Nessun flusso nel periodo per questi tag.
          </p>
        ) : (
          <PeriodSankeyChart data={sankeyData} className="mt-6 h-[420px] w-full" />
        )}
      </Card>

      {configured && loading ? (
        <p className="flex items-center gap-2 text-[12px] text-tremor-content-subtle">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Caricamento transazioni…
        </p>
      ) : null}
    </div>
  );
}
