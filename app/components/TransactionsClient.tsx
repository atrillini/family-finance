"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Repeat,
  ArrowDownLeft,
  ArrowUpRight,
  X,
  Filter,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import TransactionsTable from "./TransactionsTable";
import AddTransaction from "./AddTransaction";
import SmartSearchBar from "./SmartSearchBar";
import SemanticInterpretationPanel from "./SemanticInterpretationPanel";
import DateRangePicker from "./DateRangePicker";
import MonthNavigator from "./MonthNavigator";
import BulkActionsBar from "./BulkActionsBar";
import TransactionsTableSkeleton from "./premium/TransactionsTableSkeleton";
import EditTransactionModal, {
  type EditTransactionPatch,
} from "./EditTransactionModal";
import {
  computeMonthlySummary,
  formatCurrency,
  type Account,
  type Transaction,
} from "@/lib/mock-data";
import {
  getSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase";
import {
  TRANSACTION_CATEGORIES,
  type ParsedQuery,
  type TransactionCategory,
} from "@/lib/gemini";
import {
  applySupabaseFilter,
  rowMatchesFilter,
} from "@/lib/semantic-transaction-filter";
import { useHeaderSearch } from "@/lib/search-context";
import {
  formatRangeLabel,
  isDateInRange,
  rangeToIsoBounds,
  rangesEqual,
  type DateRange,
} from "@/lib/date-range";
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
import { dateRangeFromIso } from "@/lib/default-month-range";
import { fetchTransactionsBatched } from "@/lib/supabase-transactions-batched";
import { isTransactionVisible } from "@/lib/transaction-visibility";
import {
  buildCommercialistaCsv,
  commercialistaCsvFilename,
} from "@/lib/export-transactions-csv";
import { downloadTextFile } from "@/lib/download-text-file";
import { REFETCH_ACCOUNTS_EVENT } from "@/lib/cash-wallet";

type TypeFilter = "all" | "income" | "expense" | "subscription";

type Props = {
  defaultRangeIso: { fromIso: string; toIso: string };
  fallback?: Transaction[];
  accountsFallback?: Account[];
};

/**
 * Client completo per la pagina "Transazioni". Riusa gli stessi componenti
 * della dashboard (TransactionsTable, EditTransactionModal, AddTransaction)
 * con in più un pannello di filtri persistenti utili quando si ispeziona
 * lo storico completo dei movimenti:
 *   - tipo (tutti / entrate / uscite / solo ricorrenti);
 *   - conto di riferimento;
 *   - categoria.
 * Il testo dell'header (barra di ricerca globale) viene applicato sopra a
 * tutti gli altri filtri.
 *
 * NOTA sulla duplicazione con `DashboardClient`: la logica di fetch +
 * realtime + edit + delete-con-undo è volutamente replicata qui perché
 * questa pagina ha esigenze diverse (limit più alto, ricerca semantica
 * NL come la dashboard, set di filtri dedicato). Se in futuro si dovesse
 * uniformare, estrarre un hook `useTransactionsStore` che incapsuli
 * `transactions`, `accounts`, `save`, `delete` resta la mossa naturale.
 */
export default function TransactionsClient({
  defaultRangeIso,
  fallback = [],
  accountsFallback = [],
}: Props) {
  const configured = isSupabaseConfigured();

  const [transactions, setTransactions] = useState<Transaction[]>(fallback);
  const [accounts, setAccounts] = useState<Account[]>(accountsFallback);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [recategorizingIds, setRecategorizingIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [accountFilter, setAccountFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange | null>(() =>
    dateRangeFromIso(defaultRangeIso)
  );
  const [activeQuery, setActiveQuery] = useState<ParsedQuery | null>(null);

  const { query: headerQuery, setQuery: setHeaderQuery } = useHeaderSearch();

  // Chiave stabile del range usata come dipendenza dell'effetto di fetch
  // (ri-carica da Supabase quando l'utente cambia periodo).
  const rangeKey = dateRange
    ? `${dateRange.from.getTime()}|${(dateRange.to ?? dateRange.from).getTime()}`
    : "";

  const filterKey = activeQuery
    ? `${activeQuery.filter.column}|${activeQuery.filter.operator}|${activeQuery.filter.value}`
    : "";

  const refetchAccountsList = useCallback(async () => {
    if (!configured) return;
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) setError(error.message);
    else setAccounts((data ?? []) as Account[]);
  }, [configured]);

  // ---------------------------------------------------------------------------
  // Fetch + realtime: transazioni.
  // ---------------------------------------------------------------------------
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
      .channel("transactions-realtime-page")
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
              if (dateRange && !isDateInRange(row.date, dateRange)) return prev;
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
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, rangeKey, filterKey]);

  // ---------------------------------------------------------------------------
  // Fetch + realtime: conti (servono per i filtri e per il modal di edit).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!configured) return;
    const supabase = getSupabaseClient();

    void refetchAccountsList();

    const channel = supabase
      .channel("accounts-realtime-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accounts" },
        (payload) => {
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [configured, refetchAccountsList]);

  useEffect(() => {
    if (!configured) return;
    const onRefetchAccounts = () => {
      void refetchAccountsList();
    };
    window.addEventListener(REFETCH_ACCOUNTS_EVENT, onRefetchAccounts);
    return () =>
      window.removeEventListener(REFETCH_ACCOUNTS_EVENT, onRefetchAccounts);
  }, [configured, refetchAccountsList]);

  // ---------------------------------------------------------------------------
  // Righe nel solo ambito periodo + ricerca NL (per totali pannello interpretazione).
  // ---------------------------------------------------------------------------
  const nlScopeRows = useMemo<Transaction[]>(() => {
    if (configured) return transactions;
    let rows = transactions;
    if (dateRange) {
      rows = rows.filter((t) => isDateInRange(t.date, dateRange));
    }
    if (activeQuery) {
      rows = rows.filter((t) => rowMatchesFilter(t, activeQuery.filter));
    }
    return rows;
  }, [configured, transactions, dateRange, activeQuery]);

  // ---------------------------------------------------------------------------
  // Applicazione filtri locali (sopra al risultato già caricato).
  // ---------------------------------------------------------------------------
  const displayed = useMemo<Transaction[]>(() => {
    let list = transactions;

    if (!configured && activeQuery) {
      list = list.filter((t) => rowMatchesFilter(t, activeQuery.filter));
    }

    if (typeFilter === "income") list = list.filter((t) => t.amount >= 0);
    else if (typeFilter === "expense") list = list.filter((t) => t.amount < 0);
    else if (typeFilter === "subscription")
      list = list.filter((t) => t.is_subscription);

    if (accountFilter) list = list.filter((t) => t.account_id === accountFilter);
    if (categoryFilter) list = list.filter((t) => t.category === categoryFilter);

    // In mock mode (nessun Supabase) applichiamo anche il range temporale
    // client-side, così l'esperienza è identica al flusso reale. Con
    // Supabase il filtro è già applicato server-side via gte/lte.
    if (!configured && dateRange) {
      list = list.filter((t) => isDateInRange(t.date, dateRange));
    }

    const q = headerQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
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
    }
    return list;
  }, [
    transactions,
    typeFilter,
    accountFilter,
    categoryFilter,
    headerQuery,
    configured,
    dateRange,
    activeQuery,
  ]);

  const csvExportRowCount = useMemo(() => {
    if (selectedIds.size > 0) {
      return displayed.filter((t) => selectedIds.has(t.id)).length;
    }
    return displayed.length;
  }, [displayed, selectedIds]);

  // Totali informativi della selezione corrente — stessa semantica delle card
  // home: giroconti esclusi (`computeMonthlySummary`).
  const totals = useMemo(() => {
    const s = computeMonthlySummary(displayed);
    return { income: s.income, expenses: s.expenses };
  }, [displayed]);

  const matchesDefaultPeriod = useMemo(
    () => rangesEqual(dateRange, dateRangeFromIso(defaultRangeIso)),
    [dateRange, defaultRangeIso.fromIso, defaultRangeIso.toIso]
  );

  const hasActiveFilters =
    typeFilter !== "all" ||
    Boolean(accountFilter) ||
    Boolean(categoryFilter) ||
    Boolean(headerQuery.trim()) ||
    Boolean(activeQuery) ||
    !matchesDefaultPeriod;

  const handleExportCsv = useCallback(() => {
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
        ? `Ricerca NL: ${activeQuery.explanation}`
        : activeQuery
          ? `Filtro NL: ${activeQuery.filter.column} ${activeQuery.filter.operator} ${String(activeQuery.filter.value)}`
          : null,
      headerQuery.trim() ? `Testo: ${headerQuery.trim()}` : null,
      categoryFilter ? `Categoria: ${categoryFilter}` : null,
      accountFilter
        ? `Conto: ${
            accounts.find((a) => a.id === accountFilter)?.name ?? accountFilter
          }`
        : null,
      typeFilter !== "all" ? `Tipo: ${typeFilter}` : null,
      selectedIds.size > 0
        ? `Selezione: ${rows.length} / ${displayed.length} filtrati`
        : `Righe: ${rows.length}`,
    ].filter(Boolean);
    const csv = buildCommercialistaCsv(rows, accounts, {
      note: noteParts.join(" · "),
    });
    downloadTextFile(commercialistaCsvFilename("movimenti"), csv);
    toast.success(`CSV esportato (${rows.length} movimenti).`);
  }, [
    selectedIds,
    displayed,
    dateRange,
    headerQuery,
    categoryFilter,
    accountFilter,
    typeFilter,
    accounts,
    activeQuery,
  ]);

  function resetFilters() {
    setTypeFilter("all");
    setAccountFilter("");
    setCategoryFilter("");
    setHeaderQuery("");
    setActiveQuery(null);
    setDateRange(dateRangeFromIso(defaultRangeIso));
  }

  // ---------------------------------------------------------------------------
  // Edit (optimistic) + delete (toast con undo). Stessa semantica della
  // dashboard: se Supabase è configurato persiste, altrimenti resta solo
  // nello stato locale (utile per il mock mode).
  // ---------------------------------------------------------------------------
  async function handleSave(id: string, patch: EditTransactionPatch) {
    const prev = transactions;
    const before = prev.find((t) => t.id === id);
    setTransactions((cur) =>
      cur.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
    if (!configured) return;
    try {
      const supabase = getSupabaseClient();
      // Vedi nota in DashboardClient: `count: "exact"` ci fa intercettare il
      // caso "0 righe toccate" che con RLS attive si presenta senza errore.
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
      setTransactions(prev);
      throw err instanceof Error
        ? err
        : new Error("Errore di salvataggio.");
    }
  }

  function handleDelete(id: string) {
    const idx = transactions.findIndex((t) => t.id === id);
    if (idx === -1) return Promise.resolve();
    const victim = transactions[idx];

    let undone = false;
    let committed = false;

    setTransactions((cur) => cur.filter((t) => t.id !== id));

    const restore = () =>
      setTransactions((cur) => {
        if (cur.some((x) => x.id === id)) return cur;
        const next = [...cur];
        next.splice(Math.min(idx, next.length), 0, victim);
        return next;
      });

    const commit = async () => {
      if (undone || committed) return;
      committed = true;
      if (!configured) return;
      try {
        const supabase = getSupabaseClient();
        const { error, count, data } = await supabase
          .from("transactions")
          .update({ is_hidden: true }, { count: "exact" })
          .eq("id", id)
          .eq("is_hidden", false)
          .select("id");
        if (error) throw error;
        const touched = count ?? data?.length ?? 0;
        console.info("[transazioni/soft-hide]", { id, touched });
        if (touched === 0) {
          throw new Error(
            "La transazione non è stata nascosta. Controlla le policy RLS UPDATE su public.transactions."
          );
        }
      } catch (err) {
        console.error("[transazioni/delete] commit failed", err);
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
      onAutoClose: () => void commit(),
      onDismiss: () => void commit(),
    });

    return Promise.resolve();
  }

  /**
   * Ricategorizzazione AI di una singola transazione. Stesso flusso del
   * DashboardClient: chiamata a `/api/recategorize`, optimistic update del
   * record in lista e toast di successo/errore.
   */
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
      console.error("[transazioni/recategorize]", err);
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
  // Bulk actions: stessa logica della dashboard. Vedi DashboardClient per le
  // note sui caveat RLS.
  // ---------------------------------------------------------------------------
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkRecategorize = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy("recategorize");
    setRecategorizingIds(new Set(ids));
    const toastId = toast.loading(`Ricategorizzo ${ids.length} transazioni…`);
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
      for (const r of results) if (r.ok && r.transaction) updates.set(r.id, r.transaction);
      setTransactions((cur) =>
        cur.map((t) => (updates.has(t.id) ? updates.get(t.id)! : t))
      );
      toast.success(`${json.okCount}/${json.total} ricategorizzate`, {
        id: toastId,
        description:
          json.failCount > 0
            ? `${json.failCount} errori (vedi console).`
            : "Categorie aggiornate.",
      });
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

  const bulkUpdateFields = useCallback(
    async (
      patch: Partial<
        Pick<Transaction, "category" | "is_transfer" | "account_id" | "tags">
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
        toast.success(label, { description: `${count} transazioni aggiornate.` });

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
      bulkUpdateFields(
        { category },
        `Categoria impostata: ${category}`,
        "category"
      ),
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
  // Render
  // ---------------------------------------------------------------------------
  const tableTitle = activeQuery
    ? `Ricerca intelligente · ${displayed.length} movimenti`
    : hasActiveFilters
      ? `Risultati filtrati · ${displayed.length} movimenti`
      : "Storico movimenti";

  return (
    <div
      className={`space-y-8${selectedIds.size > 0 ? " pt-14" : ""}`}
    >
      {!configured ? (
        <div className="card-surface flex items-start gap-3 p-4 text-[13px]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--color-accent)]" />
          <p className="text-[color:var(--color-muted-foreground)]">
            Supabase non è configurato: stai vedendo dati di esempio. Imposta{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in{" "}
            <code className="font-mono">.env.local</code> per abilitare il
            salvataggio reale.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="card-surface flex items-start gap-3 border-[color:var(--color-expense)]/30 p-4 text-[13px] text-[color:var(--color-expense)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Errore nel caricamento: {error}</p>
        </div>
      ) : null}

      <AddTransaction
        accounts={accounts}
        tagSuggestions={distinctTagSuggestions}
      />

      <SmartSearchBar active={activeQuery} onApply={setActiveQuery} />
      {activeQuery ? (
        <SemanticInterpretationPanel
          active={activeQuery}
          rows={nlScopeRows}
          headerRefineActive={Boolean(headerQuery.trim())}
        />
      ) : null}

      <FiltersPanel
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        accountFilter={accountFilter}
        setAccountFilter={setAccountFilter}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        accounts={accounts}
        headerQuery={headerQuery}
        clearHeaderQuery={() => setHeaderQuery("")}
        dateRange={dateRange}
        setDateRange={setDateRange}
        hasActiveFilters={hasActiveFilters}
        onReset={resetFilters}
        totals={totals}
        shownCount={displayed.length}
        totalCount={transactions.length}
        onExportCsv={() => void handleExportCsv()}
        exportDisabled={csvExportRowCount === 0}
      />

      {loading && displayed.length === 0 ? (
        <TransactionsTableSkeleton />
      ) : (
        <TransactionsTable
          transactions={displayed}
          title={tableTitle}
          defaultPageSize={25}
          onRowClick={(tx) => setEditing(tx)}
          onCategoryClick={(cat) => setCategoryFilter(cat)}
          onTagClick={(tag) => setHeaderQuery(tag)}
          onRecategorize={handleRecategorize}
          recategorizingIds={recategorizingIds}
          selectable
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          tagSuggestions={distinctTagSuggestions}
        />
      )}

      <BulkActionsBar
        count={selectedIds.size}
        accounts={accounts}
        busy={bulkBusy}
        onClear={clearSelection}
        onRecategorize={handleBulkRecategorize}
        onDelete={handleBulkDelete}
        onToggleTransfer={handleBulkToggleTransfer}
        onSetCategory={handleBulkSetCategory}
        onSetAccount={handleBulkSetAccount}
        onAddTags={handleBulkAddTags}
        tagSuggestions={distinctTagSuggestions}
      />

      <EditTransactionModal
        transaction={editing}
        accounts={accounts}
        tagSuggestions={distinctTagSuggestions}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        onDelete={handleDelete}
        onReparseFromPayload={
          configured ? handleReparseFromPayload : undefined
        }
        onRefreshFromBank={configured ? handleRefreshFromBank : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pannello dei filtri (sotto-componente privato)
// ---------------------------------------------------------------------------

type FiltersPanelProps = {
  typeFilter: TypeFilter;
  setTypeFilter: (v: TypeFilter) => void;
  accountFilter: string;
  setAccountFilter: (v: string) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  accounts: Account[];
  headerQuery: string;
  clearHeaderQuery: () => void;
  dateRange: DateRange | null;
  setDateRange: (r: DateRange | null) => void;
  hasActiveFilters: boolean;
  onReset: () => void;
  totals: { income: number; expenses: number };
  shownCount: number;
  totalCount: number;
  onExportCsv?: () => void;
  exportDisabled?: boolean;
};

function FiltersPanel({
  typeFilter,
  setTypeFilter,
  accountFilter,
  setAccountFilter,
  categoryFilter,
  setCategoryFilter,
  accounts,
  headerQuery,
  clearHeaderQuery,
  dateRange,
  setDateRange,
  hasActiveFilters,
  onReset,
  totals,
  shownCount,
  totalCount,
  onExportCsv,
  exportDisabled,
}: FiltersPanelProps) {
  const activeAccount = accounts.find((a) => a.id === accountFilter);

  return (
    <section className="card-surface p-5 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">
              Filtri
            </h2>
            <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
              {shownCount} di {totalCount} movimenti · entrate{" "}
              <span className="font-medium text-[color:var(--color-income)]">
                {formatCurrency(totals.income)}
              </span>{" "}
              · uscite{" "}
              <span className="font-medium text-[color:var(--color-expense)]">
                {formatCurrency(totals.expenses)}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <MonthNavigator value={dateRange} onChange={setDateRange} />
          <DateRangePicker value={dateRange} onChange={setDateRange} />
          {onExportCsv ? (
            <button
              type="button"
              onClick={onExportCsv}
              disabled={exportDisabled}
              title="Esporta in CSV i movimenti filtrati (o solo quelli selezionati)"
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-8 text-[12px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2} />
              Esporta CSV
            </button>
          ) : null}
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-8 text-[12px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
            >
              <X className="h-3.5 w-3.5" />
              Azzera filtri
            </button>
          ) : null}
        </div>
      </header>

      {/* Chip tipo */}
      <div className="flex flex-wrap items-center gap-2">
        <TypeChip
          active={typeFilter === "all"}
          onClick={() => setTypeFilter("all")}
        >
          Tutti
        </TypeChip>
        <TypeChip
          active={typeFilter === "income"}
          onClick={() => setTypeFilter("income")}
          tone="income"
          icon={<ArrowDownLeft className="h-3.5 w-3.5" strokeWidth={2.5} />}
        >
          Entrate
        </TypeChip>
        <TypeChip
          active={typeFilter === "expense"}
          onClick={() => setTypeFilter("expense")}
          tone="expense"
          icon={<ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2.5} />}
        >
          Uscite
        </TypeChip>
        <TypeChip
          active={typeFilter === "subscription"}
          onClick={() => setTypeFilter("subscription")}
          tone="accent"
          icon={<Repeat className="h-3.5 w-3.5" strokeWidth={2.5} />}
        >
          Ricorrenti
        </TypeChip>
      </div>

      {/* Select conto + categoria */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            Conto
          </label>
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            disabled={accounts.length === 0}
            className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors focus:border-[color:var(--color-accent)] disabled:opacity-60"
          >
            <option value="">Tutti i conti</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.type ? ` · ${a.type}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            Categoria
          </label>
          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value as TransactionCategory | "")
            }
            className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors focus:border-[color:var(--color-accent)]"
          >
            <option value="">Tutte le categorie</option>
            {TRANSACTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Pill dei filtri attivi (escluso "tipo" che è già evidenziato sopra) */}
      {(headerQuery.trim() || activeAccount || categoryFilter || dateRange) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
            Attivi
          </span>
          {dateRange ? (
            <FilterPill onRemove={() => setDateRange(null)}>
              Periodo: {formatRangeLabel(dateRange)}
            </FilterPill>
          ) : null}
          {headerQuery.trim() ? (
            <FilterPill onRemove={clearHeaderQuery}>
              Testo: “{headerQuery.trim()}”
            </FilterPill>
          ) : null}
          {activeAccount ? (
            <FilterPill onRemove={() => setAccountFilter("")}>
              Conto: {activeAccount.name}
            </FilterPill>
          ) : null}
          {categoryFilter ? (
            <FilterPill onRemove={() => setCategoryFilter("")}>
              Categoria: {categoryFilter}
            </FilterPill>
          ) : null}
        </div>
      )}
    </section>
  );
}

function TypeChip({
  active,
  onClick,
  tone,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: "income" | "expense" | "accent";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const activeTone =
    tone === "income"
      ? "bg-[color:var(--color-income)]/15 text-[color:var(--color-income)] border-[color:var(--color-income)]/40"
      : tone === "expense"
      ? "bg-[color:var(--color-expense)]/15 text-[color:var(--color-expense)] border-[color:var(--color-expense)]/40"
      : tone === "accent"
      ? "bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)] border-[color:var(--color-accent)]/40"
      : "bg-[color:var(--color-foreground)] text-[color:var(--color-background)] border-transparent";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-[12px] font-medium transition-colors",
        active
          ? activeTone
          : "border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]",
      ].join(" ")}
    >
      {icon}
      {children}
    </button>
  );
}

function FilterPill({
  onRemove,
  children,
}: {
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-2.5 py-1 text-[12px]">
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface)] hover:text-[color:var(--color-foreground)]"
        aria-label="Rimuovi filtro"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
