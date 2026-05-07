"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Download } from "lucide-react";
import { toast } from "sonner";
import SummaryCards from "./SummaryCards";
import TransactionsTable from "./TransactionsTable";
import AddTransaction from "./AddTransaction";
import SmartSearchBar from "./SmartSearchBar";
import SemanticInterpretationPanel from "./SemanticInterpretationPanel";
import AskAI from "./AskAI";
import AccountsSection from "./AccountsSection";
import ConnectBankDialog from "./ConnectBankDialog";
import DateRangePicker from "./DateRangePicker";
import MonthNavigator from "./MonthNavigator";
import EditTransactionModal, {
  type EditTransactionPatch,
} from "./EditTransactionModal";
import EditAccountModal, {
  type EditAccountPatch,
} from "./EditAccountModal";
import BulkActionsBar from "./BulkActionsBar";
import {
  computeAccountsTotal,
  computeMonthlySummary,
  computePocketTotal,
  formatCurrency,
  type Account,
  type Transaction,
} from "@/lib/mock-data";
import { fetchCashLedgerTotals } from "@/lib/cash-ledger";
import { isCashWalletAccount } from "@/lib/cash-wallet";
import { normalizeTagLabel } from "@/lib/tag-colors";
import {
  postCategorizationExample,
  postCategorizationExamplesBulk,
} from "@/lib/categorization-learning-client";
import {
  collectLearningExamplesAfterBulkPatch,
  mergedLabelSnapshotAfterPatch,
  transactionLabelsChanged,
  transactionToLabelSnapshot,
  type LearningExamplePayload,
} from "@/lib/categorization-learning-utils";
import {
  getSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase";
import type { ParsedQuery, TransactionCategory } from "@/lib/gemini";
import {
  applySupabaseFilter,
  rowMatchesFilter,
} from "@/lib/semantic-transaction-filter";
import { useHeaderSearch } from "@/lib/search-context";
import {
  isDateInRange,
  rangeToIsoBounds,
  getPreviousRange,
  formatRangeLabel,
  type DateRange,
} from "@/lib/date-range";
import { formatPeriodHeading } from "@/lib/period-labels";
import { fetchTransactionsBatched } from "@/lib/supabase-transactions-batched";
import { isTransactionVisible } from "@/lib/transaction-visibility";
import { dateRangeFromIso } from "@/lib/default-month-range";
import {
  buildCommercialistaCsv,
  commercialistaCsvFilename,
} from "@/lib/export-transactions-csv";
import { downloadTextFile } from "@/lib/download-text-file";
import { REFETCH_ACCOUNTS_EVENT } from "@/lib/cash-wallet";
import TransactionsTableSkeleton from "./premium/TransactionsTableSkeleton";
import { FadeUpChild, FadeUpStagger } from "./premium/motion-primitives";
import {
  MIN_LOADING_SKELETON_MS,
  useMinLoading,
} from "./premium/use-min-loading";

/** Skeleton tabella al primo mount (solo con Supabase), ~stessa durata min del resto UI. */
const DASHBOARD_TABLE_INTRO_MS = MIN_LOADING_SKELETON_MS;

type Props = {
  /** Mese corrente (1° — oggi) serializzato dal server per idratazione coerente. */
  defaultRangeIso: { fromIso: string; toIso: string };
  fallback?: Transaction[];
  accountsFallback?: Account[];
};

export default function DashboardClient({
  defaultRangeIso,
  fallback = [],
  accountsFallback = [],
}: Props) {
  const configured = isSupabaseConfigured();
  const [transactions, setTransactions] = useState<Transaction[]>(fallback);
  const [accounts, setAccounts] = useState<Account[]>(accountsFallback);
  /** Somma `transactions.amount` per conto Contanti (il campo `balance` non viene aggiornato dal sync). */
  const [cashLedger, setCashLedger] = useState<Record<string, number>>({});
  const [ledgerTick, setLedgerTick] = useState(0);
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;

  const [loading, setLoading] = useState(configured);
  const [loadingAccounts, setLoadingAccounts] = useState(configured);
  const loadingTransactionsUi = useMinLoading(loading);
  const loadingAccountsUi = useMinLoading(loadingAccounts);
  /** Primo mount: mostra skeleton tabella almeno `DASHBOARD_TABLE_INTRO_MS` se `configured`. */
  const [tableFirstMountPeek, setTableFirstMountPeek] = useState(() =>
    Boolean(configured)
  );
  const [error, setError] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState<ParsedQuery | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(() =>
    dateRangeFromIso(defaultRangeIso)
  );
  const [connectOpen, setConnectOpen] = useState(false);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [recategorizingIds, setRecategorizingIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [cleaningHistory, setCleaningHistory] = useState(false);
  const [previousSummary, setPreviousSummary] = useState<{
    income: number;
    expenses: number;
  } | null>(null);

  // Testo di ricerca dell'header (condiviso via context).
  const { query: headerQuery, setQuery: setHeaderQuery } = useHeaderSearch();

  useEffect(() => {
    if (!configured) {
      setTableFirstMountPeek(false);
      return;
    }
    const id = window.setTimeout(() => {
      setTableFirstMountPeek(false);
    }, DASHBOARD_TABLE_INTRO_MS);
    return () => window.clearTimeout(id);
  }, [configured]);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const list = accountsRef.current;
    const ids = list.filter(isCashWalletAccount).map((a) => a.id);
    void (async () => {
      if (ids.length === 0) {
        if (!cancelled) setCashLedger({});
        return;
      }
      try {
        const supabase = getSupabaseClient();
        const totals = await fetchCashLedgerTotals(supabase, ids);
        if (!cancelled) setCashLedger(totals);
      } catch (e) {
        console.warn("[dashboard/cash-ledger]", e);
        if (!cancelled) setCashLedger({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, accounts, ledgerTick]);

  const accountsDisplay = useMemo(
    () =>
      accounts.map((a) => {
        if (!isCashWalletAccount(a)) return a;
        if (!Object.prototype.hasOwnProperty.call(cashLedger, a.id)) return a;
        return { ...a, balance: cashLedger[a.id]! };
      }),
    [accounts, cashLedger]
  );

  // Router + search params per gestire il flash message dopo il callback
  // GoCardless (es. `/?bank=connected&count=1&requisition=...`).
  const router = useRouter();
  const searchParams = useSearchParams();

  const filterKey = activeQuery
    ? `${activeQuery.filter.column}|${activeQuery.filter.operator}|${activeQuery.filter.value}`
    : "";

  // Chiave stabile del range: usata come dipendenza dell'effetto di fetch
  // così che il refetch parta ogni volta che l'utente cambia periodo.
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
        const { fromIso, toIso } = dateRange
          ? rangeToIsoBounds(dateRange)
          : { fromIso: undefined as string | undefined, toIso: undefined as string | undefined };

        const data = await fetchTransactionsBatched(supabase, {
          dateFromIso: fromIso,
          dateToIso: toIso,
          modify: activeQuery
            ? (q) => applySupabaseFilter(q, activeQuery.filter)
            : undefined,
        });

        if (cancelled) return;
        setTransactions(data as Transaction[]);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Errore di caricamento");
        setTransactions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    const channel = supabase
      .channel("transactions-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transactions" },
        (payload) => {
          setTransactions((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as Transaction;
              if (!isTransactionVisible(row)) return prev;
              if (activeQuery && !rowMatchesFilter(row, activeQuery.filter)) {
                return prev;
              }
              if (dateRange && !isDateInRange(row.date, dateRange)) {
                return prev;
              }
              if (prev.some((p) => p.id === row.id)) return prev;
              return [row, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as Transaction;
              if (!isTransactionVisible(row)) {
                return prev.filter((p) => p.id !== row.id);
              }
              const outOfFilter =
                (activeQuery && !rowMatchesFilter(row, activeQuery.filter)) ||
                (dateRange && !isDateInRange(row.date, dateRange));
              if (outOfFilter) {
                return prev.filter((p) => p.id !== row.id);
              }
              return prev.map((p) => (p.id === row.id ? row : p));
            }
            if (payload.eventType === "DELETE") {
              const row = payload.old as Transaction;
              return prev.filter((p) => p.id !== row.id);
            }
            return prev;
          });
          setLedgerTick((n) => n + 1);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, filterKey, rangeKey]);

  /**
   * Ricarica la lista conti da Supabase. Esposta come callback così può essere
   * richiamata anche dopo il callback GoCardless (che altrimenti dovrebbe
   * attendere l'evento realtime).
   */
  const refetchAccounts = useCallback(async (): Promise<Account[]> => {
    if (!configured) return [];
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) {
        console.error("[dashboard/accounts] fetch error", error);
        setError(error.message);
        return [];
      }
      const list = (data ?? []) as Account[];
      console.info(
        "[dashboard/accounts] loaded",
        list.length,
        list.map((a) => ({
          id: a.id,
          name: a.name,
          requisition_id: a.requisition_id,
          gocardless_account_id: a.gocardless_account_id,
        }))
      );
      setAccounts(list);
      return list;
    } catch (err) {
      console.error("[dashboard/accounts] unexpected error", err);
      return [];
    }
  }, [configured]);

  // Fetch + realtime dei conti. Stesso pattern delle transazioni: carichiamo
  // una volta e ci sottoscriviamo ai cambiamenti così il "Saldo totale" e le
  // card restano sempre allineati al DB senza reload manuale.
  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseClient();
    let cancelled = false;

    (async () => {
      setLoadingAccounts(true);
      await refetchAccounts();
      if (!cancelled) setLoadingAccounts(false);
    })();

    const channel = supabase
      .channel("accounts-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accounts" },
        (payload) => {
          console.info("[dashboard/accounts] realtime", payload.eventType, {
            id:
              (payload.new as { id?: string } | null)?.id ??
              (payload.old as { id?: string } | null)?.id,
          });
          setAccounts((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as Account;
              if (prev.some((p) => p.id === row.id)) return prev;
              return [...prev, row];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as Account;
              return prev.map((p) => (p.id === row.id ? row : p));
            }
            if (payload.eventType === "DELETE") {
              const row = payload.old as Account;
              return prev.filter((p) => p.id !== row.id);
            }
            return prev;
          });
        }
      )
      .subscribe((status) => {
        console.info("[dashboard/accounts] realtime channel status", status);
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [configured, refetchAccounts]);

  useEffect(() => {
    if (!configured) return;
    const onRefetchAccounts = () => {
      void refetchAccounts();
    };
    window.addEventListener(REFETCH_ACCOUNTS_EVENT, onRefetchAccounts);
    return () =>
      window.removeEventListener(REFETCH_ACCOUNTS_EVENT, onRefetchAccounts);
  }, [configured, refetchAccounts]);

  // Base: se non c'è Supabase, partiamo dai mock; altrimenti dallo state.
  // In entrambi i casi applichiamo qui anche il filtro per range di date,
  // così il comportamento "mock mode" resta coerente con quello reale.
  const baseRows = useMemo<Transaction[]>(() => {
    const source = configured ? transactions : fallback;
    let rows = source;
    if (!configured && activeQuery) {
      rows = rows.filter((r) => rowMatchesFilter(r, activeQuery.filter));
    }
    if (!configured && dateRange) {
      rows = rows.filter((r) => isDateInRange(r.date, dateRange));
    }
    return rows;
  }, [configured, transactions, fallback, activeQuery, dateRange]);

  // Filtro testuale dell'header (in tempo reale su descrizione, esercente, tag
  // e categoria). Applicato sopra ai filtri Supabase/Gemini: agisce come
  // restringimento client-side, così anche quando una ricerca semantica è
  // attiva si può filtrare ulteriormente.
  const displayed = useMemo<Transaction[]>(() => {
    const q = headerQuery.trim().toLowerCase();
    if (!q) return baseRows;
    return baseRows.filter((t) => {
      const hay = [
        t.description,
        t.merchant ?? "",
        t.category,
        ...(t.tags ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [baseRows, headerQuery]);

  const csvExportRowCount = useMemo(() => {
    if (selectedIds.size > 0) {
      return displayed.filter((t) => selectedIds.has(t.id)).length;
    }
    return displayed.length;
  }, [displayed, selectedIds]);

  const handleExportDashboardCsv = useCallback(() => {
    const rows =
      selectedIds.size > 0
        ? displayed.filter((t) => selectedIds.has(t.id))
        : displayed;
    if (rows.length === 0) {
      toast.error("Nessun movimento da esportare.");
      return;
    }
    const noteParts = [
      dateRange ? `Periodo: ${formatRangeLabel(dateRange)}` : null,
      activeQuery?.explanation
        ? `Ricerca: ${activeQuery.explanation}`
        : activeQuery
          ? `Filtro: ${activeQuery.filter.column} ${activeQuery.filter.operator} ${String(activeQuery.filter.value)}`
          : null,
      headerQuery.trim() ? `Testo: ${headerQuery.trim()}` : null,
      selectedIds.size > 0
        ? `Selezione: ${rows.length} / ${displayed.length} filtrati`
        : `Righe: ${rows.length}`,
    ].filter(Boolean);
    const csv = buildCommercialistaCsv(rows, accountsDisplay, {
      note: noteParts.join(" · "),
    });
    downloadTextFile(commercialistaCsvFilename("dashboard_movimenti"), csv);
    toast.success(`CSV esportato (${rows.length} movimenti).`);
  }, [
    selectedIds,
    displayed,
    dateRange,
    activeQuery,
    headerQuery,
    accountsDisplay,
  ]);

  const periodHeading = useMemo(
    () => formatPeriodHeading(dateRange),
    [dateRange]
  );

  // Entrate/uscite: somma su `displayed` (stesso sottoinsieme della tabella)
  // con `computeMonthlySummary` → giroconti esclusi. Saldo = patrimonio
  // liquido sui conti (esclusi pocket), indipendente dal periodo.
  const summary = useMemo(() => {
    const base = computeMonthlySummary(displayed);
    if (accountsDisplay.length > 0) {
      return { ...base, balance: computeAccountsTotal(accountsDisplay) };
    }
    return base;
  }, [displayed, accountsDisplay]);

  const pocketBalance = useMemo(
    () => computePocketTotal(accountsDisplay),
    [accountsDisplay]
  );

  // Fetch del periodo precedente per calcolare il delta % delle card.
  // Se l'utente non ha selezionato un range, usiamo come "corrente" il mese
  // in corso e come "precedente" il mese scorso — così le card mostrano un
  // paragone sensato di default.
  const effectiveRangeKey = useMemo(() => {
    if (dateRange) return rangeKey;
    const now = new Date();
    return `auto|${now.getFullYear()}|${now.getMonth()}`;
  }, [dateRange, rangeKey]);

  useEffect(() => {
    if (!configured) {
      setPreviousSummary(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        let prevRange: DateRange | null = null;
        if (dateRange) {
          prevRange = getPreviousRange(dateRange);
        } else {
          // Default: confronto "mese corrente vs mese scorso".
          const now = new Date();
          const y = now.getFullYear();
          const m = now.getMonth();
          const prevMonthEnd = new Date(y, m, 0); // ultimo giorno del mese precedente
          const prevMonthStart = new Date(y, m - 1, 1);
          prevRange = { from: prevMonthStart, to: prevMonthEnd };
        }
        if (!prevRange) {
          if (!cancelled) setPreviousSummary(null);
          return;
        }
        const { fromIso, toIso } = rangeToIsoBounds(prevRange);
        const { data, error: prevErr } = await supabase
          .from("transactions")
          .select("amount,is_transfer")
          .eq("is_hidden", false)
          .gte("date", fromIso)
          .lte("date", toIso)
          .limit(5000);
        if (prevErr || cancelled) return;
        const rows = (data ?? []) as Array<{
          amount: number;
          is_transfer: boolean;
        }>;
        const summary = rows.reduce(
          (acc, r) => {
            if (r.is_transfer) return acc;
            if (Number(r.amount) >= 0) acc.income += Number(r.amount);
            else acc.expenses += Math.abs(Number(r.amount));
            return acc;
          },
          { income: 0, expenses: 0 }
        );
        if (!cancelled) setPreviousSummary(summary);
      } catch (err) {
        console.warn("[dashboard/prev-period] fetch error", err);
        if (!cancelled) setPreviousSummary(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, effectiveRangeKey, dateRange]);

  const tableTitle = activeQuery
    ? "Risultati della ricerca"
    : headerQuery.trim()
    ? `Risultati per "${headerQuery.trim()}"`
    : "Ultime transazioni";

  // ---------------------------------------------------------------------------
  // Handlers: edit + delete con optimistic update
  // ---------------------------------------------------------------------------

  async function handleSave(id: string, patch: EditTransactionPatch) {
    const prev = transactions;
    const before = prev.find((t) => t.id === id);
    // Applichiamo subito la modifica in UI (optimistic).
    const next: Transaction | null = before ? { ...before, ...patch } : null;
    if (next) {
      setTransactions((cur) =>
        cur.map((t) => (t.id === id ? { ...t, ...patch } : t))
      );
    }

    if (!configured) return; // mock: nessuna persistenza.

    try {
      const supabase = getSupabaseClient();
      // `count: "exact"` ci permette di distinguere il caso "RLS ha negato
      // silenziosamente la scrittura" (nessun errore, ma 0 righe toccate)
      // dal successo vero. Usiamo anche `.select()` come belt-and-suspenders:
      // con SELECT abilitata torneranno i record aggiornati.
      const { error, count, data } = await supabase
        .from("transactions")
        .update(
          {
            description: patch.description,
            merchant: patch.merchant,
            category: patch.category,
            amount: patch.amount,
            date: patch.date,
            tags: patch.tags,
            is_subscription: patch.is_subscription,
            is_transfer: patch.is_transfer,
            account_id: patch.account_id,
          },
          { count: "exact" }
        )
        .eq("id", id)
        .select("id");

      if (error) throw error;

      const touched = count ?? data?.length ?? 0;
      if (touched === 0) {
        throw new Error(
          "La modifica non è stata applicata. Probabile RLS su Supabase: aggiungi una policy UPDATE/SELECT su public.transactions."
        );
      }

      if (
        before &&
        transactionLabelsChanged(
          {
            category: before.category,
            tags: before.tags ?? [],
            merchant: before.merchant ?? null,
            is_subscription: Boolean(before.is_subscription),
            is_transfer: Boolean(before.is_transfer),
          },
          {
            category: patch.category,
            tags: patch.tags,
            merchant: patch.merchant,
            is_subscription: patch.is_subscription,
            is_transfer: patch.is_transfer,
          }
        )
      ) {
        void postCategorizationExample({
          description: patch.description,
          merchant: patch.merchant,
          category: patch.category,
          tags: patch.tags,
          is_subscription: patch.is_subscription,
          is_transfer: patch.is_transfer,
        });
      }
    } catch (err) {
      // Rollback in caso di errore.
      setTransactions(prev);
      throw err instanceof Error
        ? err
        : new Error("Errore di salvataggio.");
    }
  }

  /**
   * Soft delete (`is_hidden = true`) con pattern "toast + annulla":
   *   1. Rimuoviamo subito la riga dalla UI (optimistic).
   *   2. Toast con "Annulla" (~5s).
   *   3. Annulla → ripristino in lista, nessuna scrittura su Supabase.
   *   4. Scadenza toast → UPDATE `is_hidden` (la riga resta per dedup GoCardless).
   */
  function handleDelete(id: string) {
    const idx = transactions.findIndex((t) => t.id === id);
    if (idx === -1) return Promise.resolve();
    const victim = transactions[idx];

    let undone = false;
    let committed = false;

    setTransactions((cur) => cur.filter((t) => t.id !== id));

    const restore = () => {
      setTransactions((cur) => {
        if (cur.some((x) => x.id === id)) return cur;
        const next = [...cur];
        next.splice(Math.min(idx, next.length), 0, victim);
        return next;
      });
    };

    const commit = async () => {
      if (undone || committed) return;
      committed = true;
      if (!configured) return;
      try {
        const supabase = getSupabaseClient();
        // Con RLS attivi PostgREST ritorna { error: null, count: 0 } anche
        // quando la policy NEGA la delete: serve il `count: "exact"` per
        // distinguere "riuscita" da "silenziosamente bloccata".
        const { error, count, data } = await supabase
          .from("transactions")
          .update({ is_hidden: true }, { count: "exact" })
          .eq("id", id)
          .eq("is_hidden", false)
          .select("id");
        if (error) throw error;
        const touched = count ?? data?.length ?? 0;
        console.info("[dashboard/soft-hide]", { id, touched });
        if (touched === 0) {
          throw new Error(
            "La transazione non è stata nascosta. Controlla le policy RLS UPDATE su public.transactions."
          );
        }
      } catch (err) {
        console.error("[dashboard/delete] commit failed", err);
        restore();
        toast.error(
          err instanceof Error
            ? err.message
            : "Impossibile nascondere la transazione."
        );
      }
    };

    toast(`Transazione "${victim.description}" nascosta`, {
      description: "Sparirà dall'elenco tra pochi secondi (puoi annullare).",
      duration: 5000,
      action: {
        label: "Annulla",
        onClick: () => {
          if (committed) return;
          undone = true;
          restore();
        },
      },
      onAutoClose: () => {
        void commit();
      },
      onDismiss: () => {
        void commit();
      },
    });

    return Promise.resolve();
  }

  /**
   * Salvataggio del modal di modifica conto (name/type/logo). Applichiamo
   * subito la patch localmente (optimistic) e poi persistiamo su Supabase.
   * Come per le transazioni usiamo `count: "exact"` per intercettare il
   * caso RLS → 0 righe toccate senza errore esplicito.
   */
  async function handleAccountSave(id: string, patch: EditAccountPatch) {
    const prev = accounts;
    setAccounts((cur) =>
      cur.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );

    if (!configured) return;

    try {
      const supabase = getSupabaseClient();
      const { error, count, data } = await supabase
        .from("accounts")
        .update(
          {
            name: patch.name,
            type: patch.type,
            logo_url: patch.logo_url,
          },
          { count: "exact" }
        )
        .eq("id", id)
        .select("id");

      if (error) throw error;

      const touched = count ?? data?.length ?? 0;
      if (touched === 0) {
        throw new Error(
          "Modifica non applicata: probabile RLS su Supabase. Aggiungi una policy UPDATE/SELECT su public.accounts per la anon key."
        );
      }
    } catch (err) {
      setAccounts(prev);
      throw err instanceof Error ? err : new Error("Errore di salvataggio.");
    }
  }

  // ---------------------------------------------------------------------------
  // Ricategorizzazione AI di una singola transazione (pulsante "Sparkles").
  // Chiamiamo `/api/recategorize` che gira Gemini server-side (così non
  // esponiamo la GEMINI_API_KEY) e aggiorna direttamente la riga via
  // service-role. Il realtime poi propaga l'update alla dashboard.
  // ---------------------------------------------------------------------------
  const handleRecategorize = useCallback(async (tx: Transaction) => {
    setRecategorizingIds((prev) => {
      if (prev.has(tx.id)) return prev;
      const next = new Set(prev);
      next.add(tx.id);
      return next;
    });
    const toastId = toast.loading(`Ricategorizzo "${tx.description}"…`, {
      description: "Gemini sta analizzando la transazione.",
    });
    try {
      const resp = await fetch("/api/recategorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: tx.id }),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.ok) {
        throw new Error(
          json?.error ?? "Errore durante la ricategorizzazione."
        );
      }
      const updated = json.transaction as Transaction | undefined;
      // Anche se il realtime aggiornerà la riga a breve, lo applichiamo
      // subito localmente così la UI mostra il nuovo stato senza latenza.
      if (updated) {
        setTransactions((cur) =>
          cur.map((t) => (t.id === tx.id ? updated : t))
        );
      }
      toast.success(
        updated?.category
          ? `Categoria → ${updated.category}`
          : "Ricategorizzazione completata",
        {
          id: toastId,
          description:
            updated?.tags && updated.tags.length > 0
              ? `Tag: ${updated.tags.join(", ")}.`
              : "L'IA ha aggiornato la transazione.",
        }
      );
    } catch (err) {
      console.error("[dashboard/recategorize]", err);
      toast.error("Ricategorizzazione non riuscita", {
        id: toastId,
        description:
          err instanceof Error
            ? err.message
            : "Errore sconosciuto. Riprova fra qualche secondo.",
      });
    } finally {
      setRecategorizingIds((prev) => {
        const next = new Set(prev);
        next.delete(tx.id);
        return next;
      });
    }
  }, []);

  const handleReparseFromPayload = useCallback(async (id: string) => {
    const resp = await fetch(
      `/api/transactions/${encodeURIComponent(id)}/reparse`,
      { method: "POST" }
    );
    const json = (await resp.json()) as {
      error?: string;
      transaction?: Transaction;
    };
    if (!resp.ok) throw new Error(json?.error ?? "Errore durante il re-parse.");
    const updated = json.transaction;
    if (updated) {
      setTransactions((cur) =>
        cur.map((t) => (t.id === id ? updated : t))
      );
      setEditing((prev) => (prev?.id === id ? updated : prev));
    }
  }, []);

  const handleRefreshFromBank = useCallback(async (id: string) => {
    const resp = await fetch(
      `/api/transactions/${encodeURIComponent(id)}/refresh-bank`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowDays: 1 }),
      }
    );
    const json = (await resp.json()) as {
      error?: string;
      transaction?: Transaction;
    };
    if (!resp.ok) {
      throw new Error(json?.error ?? "Errore durante il refresh dalla banca.");
    }
    const updated = json.transaction;
    if (updated) {
      setTransactions((cur) =>
        cur.map((t) => (t.id === id ? updated : t))
      );
      setEditing((prev) => (prev?.id === id ? updated : prev));
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Bulk actions: ricategorizzazione / delete / toggle transfer / set category /
  // move account di più transazioni in una volta. Ogni operazione è ottimistica
  // e aggiorna subito la UI.
  // ---------------------------------------------------------------------------

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkRecategorize = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy("recategorize");
    setRecategorizingIds(new Set(ids));
    const toastId = toast.loading(`Ricategorizzo ${ids.length} transazioni…`, {
      description: "Può richiedere qualche secondo con Gemini.",
    });
    try {
      const resp = await fetch("/api/recategorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds: ids }),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error ?? "Errore ricategorizzazione.");

      type BatchResult =
        | { id: string; ok: true; transaction: Transaction }
        | { id: string; ok: false; error: string };

      const results = (json.results ?? []) as BatchResult[];
      const updates = new Map<string, Transaction>();
      for (const r of results) {
        if (r.ok && r.transaction) updates.set(r.id, r.transaction);
      }
      setTransactions((cur) =>
        cur.map((t) => (updates.has(t.id) ? updates.get(t.id)! : t))
      );
      toast.success(
        `${json.okCount}/${json.total} ricategorizzate`,
        {
          id: toastId,
          description:
            json.failCount > 0
              ? `${json.failCount} hanno dato errore (vedi console).`
              : "Categorie aggiornate.",
        }
      );
    } catch (err) {
      toast.error("Ricategorizzazione di gruppo fallita", {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRecategorizingIds(new Set());
      setBulkBusy(null);
    }
  }, [selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const victims = transactions.filter((t) => ids.includes(t.id));
    if (victims.length === 0) return;

    let undone = false;
    let committed = false;

    // optimistic
    setTransactions((cur) => cur.filter((t) => !selectedIds.has(t.id)));
    setSelectedIds(new Set());

    const restore = () => {
      setTransactions((cur) => {
        const present = new Set(cur.map((x) => x.id));
        const toRestore = victims.filter((v) => !present.has(v.id));
        return [...toRestore, ...cur];
      });
    };

    const commit = async () => {
      if (undone || committed) return;
      committed = true;
      if (!configured) return;
      setBulkBusy("delete");
      try {
        const supabase = getSupabaseClient();
        const { error, count } = await supabase
          .from("transactions")
          .update({ is_hidden: true }, { count: "exact" })
          .in("id", ids)
          .eq("is_hidden", false);
        if (error) throw error;
        if ((count ?? 0) === 0) {
          throw new Error(
            "Nessuna riga nascosta: probabile RLS. Verifica le policy UPDATE su public.transactions."
          );
        }
      } catch (err) {
        restore();
        toast.error("Impossibile nascondere le transazioni", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBulkBusy(null);
      }
    };

    toast(`${victims.length} transazioni nascoste`, {
      description: "Annulla entro pochi secondi per ripristinarle in elenco.",
      duration: 6000,
      action: {
        label: "Annulla",
        onClick: () => {
          if (committed) return;
          undone = true;
          restore();
        },
      },
      onAutoClose: () => void commit(),
      onDismiss: () => void commit(),
    });
  }, [selectedIds, transactions, configured]);

  const handleBulkRefreshDescriptions = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!configured) {
      toast.error("Disponibile solo con Supabase configurato.");
      return;
    }

    const selectedRows = transactions.filter((t) => ids.includes(t.id));
    if (selectedRows.length === 0) return;
    const accountIds = [
      ...new Set(
        selectedRows.map((t) => (t.account_id ?? "").trim()).filter(Boolean)
      ),
    ];
    if (accountIds.length !== 1) {
      toast.error("Seleziona movimenti di un solo conto", {
        description:
          "Il refresh batch usa una chiamata banca per conto; seleziona un account alla volta.",
      });
      return;
    }

    const accountId = accountIds[0]!;
    setBulkBusy("refresh-descriptions");
    const toastId = toast.loading(
      `Aggiorno ${ids.length} transazioni da banca (batch)…`
    );
    try {
      const resp = await fetch("/api/refresh-descriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          onlyIds: ids,
          recategorizeAltro: false,
        }),
      });
      const json = (await resp.json()) as {
        error?: string;
        report?: { updated: number; matched: number };
      };
      if (!resp.ok) {
        throw new Error(
          json?.error ?? "Errore durante il refresh descrizioni batch."
        );
      }
      const updated = Number(json?.report?.updated ?? 0);
      const matched = Number(json?.report?.matched ?? 0);
      toast.success("Refresh descrizioni completato", {
        id: toastId,
        description: `${updated} aggiornate su ${matched} selezionate (1 chiamata banca).`,
      });
    } catch (err) {
      toast.error("Refresh descrizioni fallito", {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBulkBusy(null);
    }
  }, [selectedIds, transactions, configured]);

  const bulkUpdateFields = useCallback(
    async (
      patch: Partial<
        Pick<
          Transaction,
          "category" | "is_transfer" | "account_id" | "tags"
        >
      >,
      label: string,
      busyKey: string
    ) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      const prev = transactions;
      setTransactions((cur) =>
        cur.map((t) => (selectedIds.has(t.id) ? { ...t, ...patch } : t))
      );
      setBulkBusy(busyKey);
      try {
        if (!configured) {
          toast.success(label);
          return;
        }
        const supabase = getSupabaseClient();
        const { error, count } = await supabase
          .from("transactions")
          .update(patch, { count: "exact" })
          .in("id", ids);
        if (error) throw error;
        if ((count ?? 0) === 0) {
          throw new Error(
            "Nessuna riga aggiornata. Probabile RLS: verifica le policy UPDATE su public.transactions."
          );
        }
        toast.success(label, {
          description: `${count} transazioni aggiornate.`,
        });

        const bulkLearning = collectLearningExamplesAfterBulkPatch(
          prev,
          ids,
          patch
        );
        if (bulkLearning.length > 0) {
          void postCategorizationExamplesBulk(bulkLearning);
        }
      } catch (err) {
        setTransactions(prev);
        toast.error(`${label} non riuscito`, {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBulkBusy(null);
      }
    },
    [selectedIds, transactions, configured]
  );

  const handleBulkToggleTransfer = useCallback(
    (isTransfer: boolean) =>
      bulkUpdateFields(
        { is_transfer: isTransfer },
        isTransfer ? "Marcate come giroconto" : "Giroconto rimosso",
        isTransfer ? "transfer-on" : "transfer-off"
      ),
    [bulkUpdateFields]
  );

  const handleBulkSetCategory = useCallback(
    (category: TransactionCategory) =>
      bulkUpdateFields({ category }, `Categoria impostata: ${category}`, "category"),
    [bulkUpdateFields]
  );

  const handleBulkSetAccount = useCallback(
    (accountId: string | null) => {
      const accountName = accountId
        ? accounts.find((a) => a.id === accountId)?.name ?? "Conto"
        : "Nessun conto";
      return bulkUpdateFields(
        { account_id: accountId },
        `Spostate su: ${accountName}`,
        "account"
      );
    },
    [accounts, bulkUpdateFields]
  );

  const distinctTagSuggestions = useMemo(() => {
    const s = new Set<string>();
    for (const tx of transactions) {
      for (const tag of tx.tags ?? []) {
        const n = normalizeTagLabel(tag);
        if (n) s.add(n);
      }
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const handleBulkAddTags = useCallback(
    async (extra: string[]) => {
      const add = [
        ...new Set(extra.map((t) => normalizeTagLabel(t)).filter(Boolean)),
      ];
      if (add.length === 0) return;
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;

      const prev = transactions;
      const updates = new Map<string, string[]>();
      for (const id of ids) {
        const row = prev.find((t) => t.id === id);
        const merged = [...new Set([...(row?.tags ?? []), ...add])];
        updates.set(id, merged);
      }

      setTransactions((cur) =>
        cur.map((t) =>
          updates.has(t.id) ? { ...t, tags: updates.get(t.id)! } : t
        )
      );

      setBulkBusy("tags");
      try {
        if (!configured) {
          toast.success(`Tag aggiunti a ${ids.length} transazioni`);
          return;
        }
        const supabase = getSupabaseClient();
        await Promise.all(
          [...updates.entries()].map(([id, tags]) =>
            supabase.from("transactions").update({ tags }).eq("id", id)
          )
        );
        toast.success("Tag applicati", {
          description: `${add.join(", ")} · ${ids.length} movimenti.`,
        });

        const bulkLearning: LearningExamplePayload[] = [];
        for (const id of ids) {
          const tx = prev.find((t) => t.id === id);
          if (!tx) continue;
          const mergedTags = updates.get(id)!;
          const before = transactionToLabelSnapshot(tx);
          const after = mergedLabelSnapshotAfterPatch(tx, {
            tags: mergedTags,
          });
          if (!transactionLabelsChanged(before, after)) continue;
          bulkLearning.push({
            description: tx.description,
            merchant: tx.merchant ?? null,
            category: after.category,
            tags: after.tags,
            is_subscription: after.is_subscription,
            is_transfer: after.is_transfer,
          });
        }
        if (bulkLearning.length > 0) {
          void postCategorizationExamplesBulk(bulkLearning);
        }
      } catch (err) {
        setTransactions(prev);
        toast.error("Aggiornamento tag non riuscito", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBulkBusy(null);
      }
    },
    [selectedIds, transactions, configured]
  );

  // ---------------------------------------------------------------------------
  // Disconnect banca: lo richiamiamo dal modal di modifica conto. Una volta
  // revocata la requisition su GoCardless e (opzionalmente) cancellate le
  // transazioni, ricarichiamo i conti per riflettere la modifica.
  // ---------------------------------------------------------------------------
  const handleAccountDisconnect = useCallback(
    async (
      accountId: string,
      options: { deleteTransactions: boolean; deleteAccount: boolean }
    ) => {
      const resp = await fetch("/api/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          deleteTransactions: options.deleteTransactions,
          deleteAccount: options.deleteAccount,
        }),
      });
      const json = await resp.json();
      if (!resp.ok)
        throw new Error(json?.error ?? "Impossibile scollegare la banca.");
      toast.success("Banca scollegata", {
        description:
          options.deleteTransactions && json.transactionsDeleted
            ? `Eliminate ${json.transactionsDeleted} transazioni collegate.`
            : options.deleteAccount
            ? "Conto eliminato dal database."
            : "Il conto resta visibile ma non è più collegato a GoCardless.",
      });
      await refetchAccounts();
    },
    [refetchAccounts]
  );

  // ---------------------------------------------------------------------------
  // Refresh descrizioni: ri-scarica le transazioni dalla banca e aggiorna
  // SOLO `description`/`merchant` sulle righe già in DB. Non tocca categorie,
  // tag, giroconti, note. Le modifiche arrivano in UI via canale realtime.
  // ---------------------------------------------------------------------------
  const handleRefreshDescriptions = useCallback(
    async (
      accountId: string,
      options: { recategorizeAltro: boolean }
    ) => {
      const pending = toast.loading("Aggiornamento descrizioni dalla banca…", {
        description:
          "Potrebbe richiedere qualche secondo (e qualche minuto se stiamo anche ricategorizzando).",
      });
      try {
        const resp = await fetch("/api/refresh-descriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            recategorizeAltro: options.recategorizeAltro,
          }),
        });
        const json = await resp.json();
        if (!resp.ok || !json?.ok) {
          throw new Error(
            json?.error ?? "Impossibile aggiornare le descrizioni."
          );
        }
        const r = json.report as {
          accountName: string;
          fetched: number;
          matched: number;
          updated: number;
          recategorized: number;
          missing: number;
        };
        const parts: string[] = [];
        parts.push(`${r.updated} descrizioni aggiornate su ${r.matched}`);
        if (options.recategorizeAltro) {
          parts.push(`${r.recategorized} ricategorizzate via IA`);
        }
        if (r.missing > 0) {
          parts.push(`${r.missing} sulla banca non sono in DB (usa Sincronizza)`);
        }
        toast.success(`Descrizioni aggiornate — ${r.accountName}`, {
          id: pending,
          description: parts.join(" · "),
        });
      } catch (err) {
        toast.error("Errore nell'aggiornamento descrizioni", {
          id: pending,
          description: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Cleanup storico: chiamata una-tantum che rimuove tutte le transazioni
  // precedenti al floor (di default 1° gennaio 2026). Serve quando l'utente
  // ha importato uno storico troppo ampio e vuole ripartire "pulito".
  // ---------------------------------------------------------------------------
  const handleCleanupHistory = useCallback(async () => {
    if (cleaningHistory) return;
    // 1) Dry-run per sapere quante righe cancelleremmo prima di chiedere
    //    conferma: così evitiamo un prompt vuoto se non c'è nulla da pulire.
    setCleaningHistory(true);
    let wouldDelete = 0;
    try {
      const resp = await fetch("/api/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error ?? "Errore nel conteggio.");
      }
      wouldDelete = Number(json.wouldDelete ?? 0);
    } catch (err) {
      setCleaningHistory(false);
      toast.error("Impossibile preparare la pulizia", {
        description: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (wouldDelete === 0) {
      setCleaningHistory(false);
      toast.success("Nulla da pulire", {
        description: "Non ci sono transazioni precedenti al 1° gennaio 2026.",
      });
      return;
    }

    const ok = window.confirm(
      `Sto per eliminare ${wouldDelete} transazioni precedenti al 1° gennaio 2026. ` +
        `Questa operazione è irreversibile. Procedo?`
    );
    if (!ok) {
      setCleaningHistory(false);
      return;
    }

    const toastId = toast.loading(
      `Elimino ${wouldDelete} transazioni storiche…`
    );
    try {
      const resp = await fetch("/api/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error ?? "Errore durante la pulizia.");
      }
      toast.success("Storico ripulito", {
        id: toastId,
        description: `Eliminate ${json.deleted} transazioni pre-2026. D'ora in poi la sincronizzazione parte dal 1° gennaio 2026.`,
      });
      // Il realtime propagherà le DELETE ma diamo una spinta anche lato
      // locale per avere un feedback immediato sulle cards/summary.
      setTransactions((cur) => cur.filter((t) => t.date.slice(0, 10) >= "2026-01-01"));
    } catch (err) {
      toast.error("Pulizia fallita", {
        id: toastId,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCleaningHistory(false);
    }
  }, [cleaningHistory]);

  // ---------------------------------------------------------------------------
  // Sync GoCardless: scarica transazioni reali, le passa a Gemini per la
  // categorizzazione e le inserisce su Supabase evitando duplicati.
  // ---------------------------------------------------------------------------

  const handleSync = useCallback(
    async (account: Account) => {
      if (syncingIds.has(account.id)) return;
      setSyncingIds((prev) => {
        const next = new Set(prev);
        next.add(account.id);
        return next;
      });

      const toastId = toast.loading(`Sincronizzo ${account.name}…`, {
        description: "Scarico le transazioni e le passo all'IA.",
      });

      try {
        const resp = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: account.id }),
        });
        const json = await resp.json();
        if (!resp.ok || !json?.ok) {
          throw new Error(json?.error ?? "Errore durante la sincronizzazione.");
        }
        const report = (json.report ?? {}) as {
          fetched?: number;
          inserted?: number;
          skipped?: number;
          balance?: number | null;
          lastSyncAt?: string;
        };
        const fetched = Number(report.fetched ?? 0);
        const inserted = Number(report.inserted ?? 0);
        const skipped = Number(report.skipped ?? 0);
        const bankBalance =
          typeof report.balance === "number" && Number.isFinite(report.balance)
            ? formatCurrency(report.balance)
            : "n/d";
        console.info("[dashboard/sync] report", {
          account: account.name,
          fetched,
          inserted,
          skipped,
          balance: report.balance ?? null,
          lastSyncAt: report.lastSyncAt ?? null,
        });
        toast.success(`${account.name} sincronizzato`, {
          id: toastId,
          description:
            inserted > 0
              ? `${inserted} nuove importate · lette ${fetched} · duplicate/skippate ${skipped} · saldo banca ${bankBalance}.`
              : `Nessuna nuova transazione · lette ${fetched} · duplicate/skippate ${skipped} · saldo banca ${bankBalance}.`,
        });
      } catch (err) {
        toast.error(`Sync di ${account.name} fallito`, {
          id: toastId,
          description:
            err instanceof Error
              ? err.message
              : "Errore sconosciuto. Riprova fra qualche secondo.",
        });
      } finally {
        setSyncingIds((prev) => {
          const next = new Set(prev);
          next.delete(account.id);
          return next;
        });
      }
    },
    [syncingIds]
  );

  // Auto-sync degli account appena collegati via requisition: se tornando
  // dal callback la dashboard riceve `?bank=connected&requisition=<id>`,
  // forziamo un refetch degli account (il realtime potrebbe non aver ancora
  // notificato l'INSERT), poi troviamo quelli legati alla requisition e
  // lanciamo un sync iniziale.
  const bankStatus = searchParams.get("bank");
  const bankRequisition = searchParams.get("requisition");
  const bankReason = searchParams.get("reason");
  const bankCount = searchParams.get("count");
  const bankMessageShownRef = useRef<string | null>(null);

  useEffect(() => {
    if (!bankStatus) return;
    const key = `${bankStatus}|${bankRequisition ?? ""}|${bankReason ?? ""}`;
    if (bankMessageShownRef.current === key) return;
    bankMessageShownRef.current = key;

    console.info("[dashboard/bank] callback received", {
      status: bankStatus,
      requisition: bankRequisition,
      count: bankCount,
      reason: bankReason,
    });

    const clearParams = () => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("bank");
      params.delete("count");
      params.delete("requisition");
      params.delete("reason");
      const qs = params.toString();
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    };

    async function runConnectedFlow(reqId: string) {
      toast.success("Conto collegato con successo!", {
        description: "Sto importando le transazioni…",
      });

      // Il callback ha appena fatto insert/update su `accounts`. Il realtime
      // Supabase può avere 1-2s di latenza: facciamo fino a 4 refetch con
      // backoff esponenziale finché non troviamo account con questa
      // requisition_id. Se dopo ~5s ancora niente, avvisiamo l'utente.
      let list: Account[] = [];
      let matched: Account[] = [];
      for (let attempt = 0; attempt < 4; attempt++) {
        list = await refetchAccounts();
        matched = list.filter((a) => a.requisition_id === reqId);
        console.info(
          `[dashboard/bank] refetch attempt ${attempt + 1}:`,
          list.length,
          "accounts totali,",
          matched.length,
          "matchano requisition",
          reqId
        );
        if (matched.length > 0) break;
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }

      if (matched.length === 0) {
        console.warn(
          "[dashboard/bank] nessun account trovato per la requisition",
          reqId,
          "— totale conti in DB:",
          list.length
        );
        toast.error("Conto non trovato su Supabase", {
          description:
            "Il callback è andato a buon fine ma nessun record 'accounts' risulta collegato. Controlla i log del server e le env SUPABASE_SERVICE_ROLE_KEY / migrazione SQL.",
          duration: 10_000,
        });
        return;
      }

      matched.forEach((a) => {
        console.info(
          "[dashboard/bank] avvio sync per",
          a.name,
          `(id=${a.id}, gc=${a.gocardless_account_id})`
        );
        void handleSync(a);
      });
    }

    if (bankStatus === "connected") {
      if (bankRequisition) {
        void runConnectedFlow(bankRequisition);
      } else {
        toast.success("Conto collegato con successo!", {
          description: "Sto importando le transazioni…",
        });
        void refetchAccounts();
      }
    } else if (bankStatus === "pending") {
      toast.message("Collegamento in corso", {
        description:
          "La banca non ha ancora restituito gli account. Riprova tra qualche minuto.",
      });
    } else if (bankStatus === "error") {
      toast.error("Collegamento non riuscito", {
        description: bankReason || "Riprova o seleziona un'altra banca.",
      });
    }

    clearParams();
  }, [
    bankStatus,
    bankRequisition,
    bankReason,
    bankCount,
    handleSync,
    refetchAccounts,
    router,
    searchParams,
  ]);

  return (
    <FadeUpStagger
      className={`space-y-8${selectedIds.size > 0 ? " pt-14" : ""}`}
    >
      {!configured ? (
        <FadeUpChild>
          <div className="card-surface flex items-start gap-3 rounded-2xl border border-zinc-800/20 p-4 text-[13px] dark:border-zinc-800/40">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--color-accent)]" />
            <p className="text-[color:var(--color-muted-foreground)]">
              Supabase non è configurato: stai vedendo dati di esempio. Imposta{" "}
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
              <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{" "}
              <code className="font-mono">.env.local</code> per abilitare il
              salvataggio reale.
            </p>
          </div>
        </FadeUpChild>
      ) : null}

      {error ? (
        <FadeUpChild>
          <div className="card-surface flex items-start gap-3 rounded-2xl border border-[color:var(--color-expense)]/30 p-4 text-[13px] text-[color:var(--color-expense)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Errore nel caricamento: {error}</p>
          </div>
        </FadeUpChild>
      ) : null}

      <FadeUpChild>
        <SummaryCards
          summary={summary}
          periodLabel={periodHeading}
          pocketBalance={pocketBalance}
          previous={previousSummary}
        />
      </FadeUpChild>

      <FadeUpChild>
        <AccountsSection
          accounts={accountsDisplay}
          loading={loadingAccountsUi}
          onAdd={() => setConnectOpen(true)}
          onSync={handleSync}
          onEdit={(acc) => setEditingAccount(acc)}
          onCleanupHistory={configured ? handleCleanupHistory : undefined}
          cleaningHistory={cleaningHistory}
          syncingAccountIds={syncingIds}
        />
      </FadeUpChild>

      <FadeUpChild>
      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-start">
        <div className="min-w-0 flex-1 space-y-3">
          <SmartSearchBar active={activeQuery} onApply={setActiveQuery} />
          {activeQuery ? (
            <SemanticInterpretationPanel
              active={activeQuery}
              rows={baseRows}
              headerRefineActive={Boolean(headerQuery.trim())}
            />
          ) : null}
        </div>
        {/*
          Navigazione mese-per-mese: frecce ◀ ▶ per scorrere + selettore
          rapido "Aprile 2026 ▼" che apre la griglia dei mesi + "Oggi".
          Convive col DateRangePicker: quest'ultimo resta per range
          personalizzati (Ultimi 7 giorni, custom, anno, ecc.).
        */}
        <div className="flex flex-wrap items-center gap-2 md:pt-4">
          <MonthNavigator value={dateRange} onChange={setDateRange} />
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          <button
            type="button"
            onClick={() => void handleExportDashboardCsv()}
            disabled={csvExportRowCount === 0}
            title="Esporta in CSV i movimenti del periodo (o solo quelli selezionati)"
            className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-8 text-[12px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            Esporta CSV
          </button>
        </div>
      </div>
      </FadeUpChild>

      <FadeUpChild>
      <AddTransaction
        accounts={accountsDisplay}
        tagSuggestions={distinctTagSuggestions}
      />
      </FadeUpChild>

      <FadeUpChild>
      {loadingTransactionsUi || tableFirstMountPeek ? (
        <TransactionsTableSkeleton />
      ) : (
        <TransactionsTable
          transactions={displayed}
          title={tableTitle}
          defaultPageSize={25}
          onRowClick={(tx) => setEditing(tx)}
          onCategoryClick={(cat) => setHeaderQuery(cat)}
          onTagClick={(tag) => setHeaderQuery(tag)}
          onRecategorize={handleRecategorize}
          recategorizingIds={recategorizingIds}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          tagSuggestions={distinctTagSuggestions}
        />
      )}
      </FadeUpChild>

      <FadeUpChild>
      <BulkActionsBar
        count={selectedIds.size}
        accounts={accountsDisplay}
        busy={bulkBusy}
        onClear={clearSelection}
        onRecategorize={handleBulkRecategorize}
        onRefreshDescriptions={handleBulkRefreshDescriptions}
        onDelete={handleBulkDelete}
        onToggleTransfer={handleBulkToggleTransfer}
        onSetCategory={handleBulkSetCategory}
        onSetAccount={handleBulkSetAccount}
        onAddTags={handleBulkAddTags}
        tagSuggestions={distinctTagSuggestions}
      />
      </FadeUpChild>

      <FadeUpChild>
      <AskAI transactions={displayed} dateRange={dateRange} />
      </FadeUpChild>

      <EditTransactionModal
        transaction={editing}
        accounts={accountsDisplay}
        tagSuggestions={distinctTagSuggestions}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        onDelete={handleDelete}
        onReparseFromPayload={
          configured ? handleReparseFromPayload : undefined
        }
        onRefreshFromBank={configured ? handleRefreshFromBank : undefined}
      />

      <EditAccountModal
        account={editingAccount}
        onClose={() => setEditingAccount(null)}
        onSave={handleAccountSave}
        onDisconnect={handleAccountDisconnect}
        onRefreshDescriptions={handleRefreshDescriptions}
      />

      <ConnectBankDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
      />
    </FadeUpStagger>
  );
}

