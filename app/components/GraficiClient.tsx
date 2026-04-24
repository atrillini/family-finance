"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { AreaChart, Card, Grid, Metric, Text, Title } from "@tremor/react";
import DateRangePicker from "./DateRangePicker";
import MonthNavigator from "./MonthNavigator";
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
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { fetchTransactionsBatched } from "@/lib/supabase-transactions-batched";
import { dateRangeFromIso } from "@/lib/default-month-range";

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
  const [dateRange, setDateRange] = useState<DateRange | null>(() =>
    dateRangeFromIso(defaultRangeIso)
  );

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

  return (
    <div className="space-y-6">
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
        {loading && chartData.length === 0 ? (
          <div className="mt-8 flex items-center justify-center gap-2 py-12 text-[13px] text-tremor-content-subtle">
            <Loader2 className="h-4 w-4 animate-spin" />
            Caricamento dati…
          </div>
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
            colors={["blue", "slate"]}
            valueFormatter={(v) => formatCurrency(v)}
            showLegend
            curveType="monotone"
            yAxisWidth={72}
          />
        )}
      </Card>

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
