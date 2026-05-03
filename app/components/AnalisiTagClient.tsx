"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  eachMonthOfInterval,
  endOfDay,
  endOfMonth,
  format,
  getISOWeek,
  getISOWeekYear,
  startOfDay,
  startOfMonth,
  subMonths,
  subWeeks,
} from "date-fns";
import { it as itLocale } from "date-fns/locale";
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
  deltaPctEarlyToLate,
  formatDeltaPctIt,
  type TaggedFlowTotals,
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

function sameCalendarMonth(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
  );
}

/**
 * Mesi di calendario da gennaio dell'anno minimo toccato fino al mese del periodo più recente.
 */
function monthComparisonContextStrip(
  chronology: {
    earlyRange: DateRange;
    lateRange: DateRange;
  },
  visibleTransactions: readonly Transaction[],
  selectedTags: readonly string[]
): { range: DateRange; label: string; isEarly: boolean; isLate: boolean; totals: TaggedFlowTotals }[] {
  const earlyStart = chronology.earlyRange.from;
  const lateStart = chronology.lateRange.from;
  const minYear = Math.min(
    earlyStart.getFullYear(),
    lateStart.getFullYear()
  );
  const gridStart = startOfMonth(new Date(minYear, 0, 1));
  const gridEndMonth = startOfMonth(lateStart);

  const months = eachMonthOfInterval({
    start: gridStart,
    end: gridEndMonth,
  });

  return months.map((monthStart) => {
    const from = startOfDay(startOfMonth(monthStart));
    const to = endOfDay(endOfMonth(monthStart));
    const range: DateRange = { from, to };
    const totals = summarizeTaggedFlows(
      visibleTransactions,
      range,
      selectedTags
    );
    const label = format(monthStart, "LLL yy", { locale: itLocale });
    return {
      range,
      label,
      isEarly: sameCalendarMonth(monthStart, earlyStart),
      isLate: sameCalendarMonth(monthStart, lateStart),
      totals,
    };
  });
}

/** Ordina i due periodi per data di inizio (poi fine): colonna Δ = più recente − più vecchio. */
function buildChronology(
  refRange: DateRange,
  cmpRange: DateRange,
  refTotals: TaggedFlowTotals,
  cmpTotals: TaggedFlowTotals
): {
  earlyRange: DateRange;
  lateRange: DateRange;
  earlyTotals: TaggedFlowTotals;
  lateTotals: TaggedFlowTotals;
} {
  const r0 = startOfDay(refRange.from).getTime();
  const c0 = startOfDay(cmpRange.from).getTime();
  const rEnd = endOfDay(refRange.to ?? refRange.from).getTime();
  const cEnd = endOfDay(cmpRange.to ?? cmpRange.from).getTime();

  const refFirst =
    r0 < c0 || (r0 === c0 && rEnd <= cEnd);

  if (refFirst) {
    return {
      earlyRange: refRange,
      lateRange: cmpRange,
      earlyTotals: refTotals,
      lateTotals: cmpTotals,
    };
  }
  return {
    earlyRange: cmpRange,
    lateRange: refRange,
    earlyTotals: cmpTotals,
    lateTotals: refTotals,
  };
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
  /** Quale delle due finestre cronologiche mostrare nel Sankey. */
  const [sankeyPeriod, setSankeyPeriod] = useState<"early" | "late">("late");

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

  const chronology = useMemo(() => {
    if (!refRange || !cmpRange) return null;
    return buildChronology(refRange, cmpRange, refTotals, cmpTotals);
  }, [refRange, cmpRange, refTotals, cmpTotals]);

  const monthlyContextSlices = useMemo(() => {
    if (periodMode !== "month" || !chronology || selectedTags.length === 0) {
      return null;
    }
    return monthComparisonContextStrip(
      chronology,
      visibleTransactions,
      selectedTags
    );
  }, [periodMode, chronology, visibleTransactions, selectedTags]);

  const sankeyRange =
    chronology == null
      ? null
      : sankeyPeriod === "early"
        ? chronology.earlyRange
        : chronology.lateRange;
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
    (kind: "income" | "expense" | "net", early: number, late: number) => {
      if (early === late) return "";
      const up = late > early;
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
          Scegli due periodi in qualsiasi ordine: in tabella vengono ordinati dal
          più vecchio al più recente e il Δ è sempre{" "}
          <span className="font-medium">recente − precedente</span>. Settimana
          ISO (lun–dom).
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
                Primo periodo
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
                Secondo periodo
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
                  Primo periodo
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
                  Secondo periodo
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
                Primo periodo
              </span>
              <DateRangePicker value={customRef} onChange={setCustomRef} />
            </div>
            <div className="space-y-2">
              <span className="text-[12px] font-medium text-tremor-content-subtle">
                Secondo periodo
              </span>
              <DateRangePicker value={customCmp} onChange={setCustomCmp} />
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <Title>Totali attribuiti al set di tag</Title>
        <Text className="mt-1 text-tremor-content-subtle">
          Giroconti esclusi; transazioni nascoste escluse.
          {periodMode === "month"
            ? " Con due mesi selezionati vedrai da gennaio dell’anno più vecchio coinvolto fino al mese più recente; le colonne evidenziate sono i due mesi del confronto."
            : null}{" "}
          Le colonne Δ / Δ % sono sempre{" "}
          <span className="font-medium">
            (recente − precedente)
          </span>
          , denominatore sul periodo più vecchio dei due. Se quello è 0 e il più
          recente no, mostriamo <span className="font-medium">Nuovo</span>.
        </Text>
        {loadingUi && selectedTags.length > 0 ? (
          <div className="mt-6 space-y-3">
            <SkeletonGlow className="h-10 w-full rounded-lg" />
            <SkeletonGlow className="h-10 w-full rounded-lg" />
            <SkeletonGlow className="h-10 w-full rounded-lg" />
          </div>
        ) : selectedTags.length === 0 || invalidWeek || !chronology ? null : monthlyContextSlices ? (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-tremor-content-subtle">
                  <th className="sticky left-0 z-[1] bg-[color:var(--color-surface)] py-2 pr-3 font-medium align-bottom shadow-[2px_0_8px_-4px_rgba(0,0,0,0.15)]">
                    Voce
                  </th>
                  {monthlyContextSlices.map((slice, idx) => {
                    const mark =
                      slice.isEarly && slice.isLate
                        ? "confronto"
                        : slice.isEarly
                          ? "precedente"
                          : slice.isLate
                            ? "recente"
                            : null;
                    return (
                      <th
                        key={`${slice.range.from.getTime()}-${idx}`}
                        title={formatRangeLabel(slice.range)}
                        className={[
                          "whitespace-nowrap px-2 py-2 align-bottom font-normal text-tremor-content-subtle",
                          slice.isEarly || slice.isLate
                            ? "border-x border-[color:var(--color-accent)]/25 bg-[color:var(--color-accent)]/[0.06]"
                            : "",
                        ].join(" ")}
                      >
                        <div className="text-[13px] font-medium capitalize tracking-tight text-[color:var(--color-foreground)]">
                          {slice.label}
                        </div>
                        {mark ? (
                          <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-[color:var(--color-accent)]">
                            {mark}
                          </div>
                        ) : null}
                      </th>
                    );
                  })}
                  <th className="border-l border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/30 py-2 pl-3 pr-2 align-bottom font-medium">
                    Δ
                  </th>
                  <th className="bg-[color:var(--color-surface-muted)]/30 py-2 pl-2 align-bottom font-medium">
                    Δ %
                  </th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    {
                      label: "Entrate",
                      early: chronology.earlyTotals.income,
                      late: chronology.lateTotals.income,
                      kind: "income" as const,
                      val: (t: TaggedFlowTotals) => t.income,
                    },
                    {
                      label: "Uscite",
                      early: chronology.earlyTotals.expense,
                      late: chronology.lateTotals.expense,
                      kind: "expense" as const,
                      val: (t: TaggedFlowTotals) => t.expense,
                    },
                    {
                      label: "Netto",
                      early:
                        chronology.earlyTotals.income -
                        chronology.earlyTotals.expense,
                      late:
                        chronology.lateTotals.income -
                        chronology.lateTotals.expense,
                      kind: "net" as const,
                      val: (t: TaggedFlowTotals) => t.income - t.expense,
                    },
                  ] as const
                ).map((row) => {
                  const dAbs = row.late - row.early;
                  const dPct = deltaPctEarlyToLate(row.early, row.late);
                  return (
                    <tr
                      key={row.label}
                      className="border-b border-[color:var(--color-border)]/60"
                    >
                      <td className="sticky left-0 z-[1] bg-[color:var(--color-surface)] py-2.5 pr-3 font-medium shadow-[2px_0_8px_-4px_rgba(0,0,0,0.12)]">
                        {row.label}
                      </td>
                      {monthlyContextSlices.map((slice, idx) => (
                        <td
                          key={`${slice.range.from.getTime()}-${row.label}-${idx}`}
                          className={[
                            "whitespace-nowrap px-2 py-2.5 tabular-nums",
                            slice.isEarly || slice.isLate
                              ? "border-x border-[color:var(--color-accent)]/25 bg-[color:var(--color-accent)]/[0.06]"
                              : "",
                          ].join(" ")}
                        >
                          {formatCurrency(row.val(slice.totals))}
                        </td>
                      ))}
                      <td
                        className={[
                          "border-l border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/20 py-2.5 pl-3 pr-2 tabular-nums font-medium",
                          pctCls(row.kind, row.early, row.late),
                        ].join(" ")}
                      >
                        {dAbs === 0
                          ? formatCurrency(0)
                          : `${dAbs > 0 ? "+" : "-"}${formatCurrency(Math.abs(dAbs))}`}
                      </td>
                      <td
                        className={[
                          "bg-[color:var(--color-surface-muted)]/20 py-2.5 pl-2 tabular-nums font-medium",
                          pctCls(row.kind, row.early, row.late),
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
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-[color:var(--color-border)] text-tremor-content-subtle">
                  <th className="py-2 pr-3 font-medium align-bottom">Voce</th>
                  <th className="py-2 pr-3 font-normal align-bottom">
                    <div className="font-medium text-tremor-content-subtle">
                      Precedente
                    </div>
                    <div className="mt-0.5 max-w-[180px] text-[10px] font-normal leading-snug text-tremor-content-subtle">
                      {formatRangeLabel(chronology.earlyRange)}
                    </div>
                  </th>
                  <th className="py-2 pr-3 font-normal align-bottom">
                    <div className="font-medium text-tremor-content-subtle">
                      Recente
                    </div>
                    <div className="mt-0.5 max-w-[180px] text-[10px] font-normal leading-snug text-tremor-content-subtle">
                      {formatRangeLabel(chronology.lateRange)}
                    </div>
                  </th>
                  <th className="py-2 pr-3 align-bottom font-medium">Δ</th>
                  <th className="py-2 align-bottom font-medium">Δ %</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    {
                      label: "Entrate",
                      early: chronology.earlyTotals.income,
                      late: chronology.lateTotals.income,
                      kind: "income" as const,
                    },
                    {
                      label: "Uscite",
                      early: chronology.earlyTotals.expense,
                      late: chronology.lateTotals.expense,
                      kind: "expense" as const,
                    },
                    {
                      label: "Netto",
                      early:
                        chronology.earlyTotals.income -
                        chronology.earlyTotals.expense,
                      late:
                        chronology.lateTotals.income -
                        chronology.lateTotals.expense,
                      kind: "net" as const,
                    },
                  ] as const
                ).map((row) => {
                  const dAbs = row.late - row.early;
                  const dPct = deltaPctEarlyToLate(row.early, row.late);
                  return (
                    <tr
                      key={row.label}
                      className="border-b border-[color:var(--color-border)]/60"
                    >
                      <td className="py-2.5 pr-3 font-medium">{row.label}</td>
                      <td className="py-2.5 pr-3 tabular-nums">
                        {formatCurrency(row.early)}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums">
                        {formatCurrency(row.late)}
                      </td>
                      <td
                        className={[
                          "py-2.5 pr-3 tabular-nums font-medium",
                          pctCls(row.kind, row.early, row.late),
                        ].join(" ")}
                      >
                        {dAbs === 0
                          ? formatCurrency(0)
                          : `${dAbs > 0 ? "+" : "-"}${formatCurrency(Math.abs(dAbs))}`}
                      </td>
                      <td
                        className={[
                          "py-2.5 tabular-nums font-medium",
                          pctCls(row.kind, row.early, row.late),
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
          Stessa aggregazione dei grafici; il periodo segue l&apos;ordine cronologico
          usato in tabella (precedente / recente).
        </Text>
        <div className="mt-3 inline-flex rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 p-0.5">
          <button
            type="button"
            onClick={() => setSankeyPeriod("early")}
            className={[
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
              sankeyPeriod === "early"
                ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-sm"
                : "text-tremor-content-subtle hover:text-[color:var(--color-foreground)]",
            ].join(" ")}
          >
            Precedente
          </button>
          <button
            type="button"
            onClick={() => setSankeyPeriod("late")}
            className={[
              "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
              sankeyPeriod === "late"
                ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-sm"
                : "text-tremor-content-subtle hover:text-[color:var(--color-foreground)]",
            ].join(" ")}
          >
            Recente
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
