"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import SummaryCards from "./SummaryCards";
import TransactionsTable from "./TransactionsTable";
import AddTransaction from "./AddTransaction";
import SmartSearchBar from "./SmartSearchBar";
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
  type Account,
  type Transaction,
} from "@/lib/mock-data";
import { normalizeTagLabel } from "@/lib/tag-colors";
import {
  getSupabaseClient,
  isSupabaseConfigured,
} from "@/lib/supabase";
import type { ParsedQuery, QueryFilter, TransactionCategory } from "@/lib/gemini";
import { useHeaderSearch } from "@/lib/search-context";
import {
  isDateInRange,
  rangeToIsoBounds,
  getPreviousRange,
  type DateRange,
} from "@/lib/date-range";

type Props = {
  monthLabel: string;
  fallback?: Transaction[];
  accountsFallback?: Account[];
};

export default function DashboardClient({
  monthLabel,
  fallback = [],
  accountsFallback = [],
}: Props) {
  const configured = isSupabaseConfigured();
  const [transactions, setTransactions] = useState<Transaction[]>(fallback);
  const [accounts, setAccounts] = useState<Account[]>(accountsFallback);
  const [loading, setLoading] = useState(configured);
  const [loadingAccounts, setLoadingAccounts] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [activeQuery, setActiveQuery] = useState<ParsedQuery | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [dateRange, setDateRange] = useState<DateRange | null>(null);
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

      let query = supabase
        .from("transactions")
        .select("*")
        .order("date", { ascending: false })
        .limit(200);

      if (activeQuery) {
        query = applySupabaseFilter(query, activeQuery.filter);
      }

      // Filtro temporale: se l'utente ha selezionato un periodo restringiamo
      // la query con gte/lte sulla colonna `date` (timestamptz). Usiamo le
      // ISO string normalizzate a inizio/fine giornata per essere inclusivi.
      if (dateRange) {
        const { fromIso, toIso } = rangeToIsoBounds(dateRange);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query = (query as any).gte("date", fromIso).lte("date", toIso);
      }

      const { data, error } = await query;

      if (cancelled) return;
      if (error) {
        setError(error.message);
      } else {
        setTransactions((data ?? []) as Transaction[]);
        setError(null);
      }
      setLoading(false);
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

  // Entrate/uscite del mese dalle transazioni visibili.
  // Il `balance` invece è ora la somma dei saldi dei conti: se c'è almeno
  // un conto registrato quello è l'unico dato "patrimoniale" affidabile
  // (le transazioni visualizzate sono un sottoinsieme filtrato); se non ci
  // sono conti cadiamo sul vecchio calcolo basato sul cashflow.
  const summary = useMemo(() => {
    const base = computeMonthlySummary(displayed);
    if (accounts.length > 0) {
      // `computeAccountsTotal` esclude per default i conti pocket/salvadanaio
      // così il Saldo Totale rispecchia la liquidità realmente disponibile.
      return { ...base, balance: computeAccountsTotal(accounts) };
    }
    return base;
  }, [displayed, accounts]);

  const pocketBalance = useMemo(() => computePocketTotal(accounts), [accounts]);

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
            if (r.amount >= 0) acc.income += Number(r.amount);
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
    // Applichiamo subito la modifica in UI (optimistic).
    const patched: Transaction | undefined = prev.find((t) => t.id === id);
    const next: Transaction | null = patched
      ? { ...patched, ...patch }
      : null;
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
    } catch (err) {
      // Rollback in caso di errore.
      setTransactions(prev);
      throw err instanceof Error
        ? err
        : new Error("Errore di salvataggio.");
    }
  }

  /**
   * Elimina una transazione con pattern "toast + annulla":
   *   1. Rimuoviamo subito la riga dalla UI (optimistic).
   *   2. Mostriamo un toast con un pulsante "Annulla" (durata ~5s).
   *   3. Se l'utente clicca Annulla → ripristiniamo la riga nella posizione
   *      originale e NON scriviamo nulla su Supabase.
   *   4. Se il toast scade (o viene chiuso con la X) → commit definitivo su
   *      Supabase. In caso d'errore del DB ripristiniamo e mostriamo un
   *      toast di errore.
   *
   * Il flag `committed`/`undone` evita double-commit quando sia `onAutoClose`
   * che `onDismiss` vengono richiamati dallo stesso ciclo di vita del toast.
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
          .delete({ count: "exact" })
          .eq("id", id)
          .select("id");
        if (error) throw error;
        const touched = count ?? data?.length ?? 0;
        console.info("[dashboard/delete]", { id, touched });
        if (touched === 0) {
          throw new Error(
            "La transazione non è stata eliminata dal database. Controlla le policy RLS su public.transactions (serve una policy DELETE sulla anon key)."
          );
        }
      } catch (err) {
        console.error("[dashboard/delete] commit failed", err);
        restore();
        toast.error(
          err instanceof Error
            ? err.message
            : "Impossibile eliminare la transazione."
        );
      }
    };

    toast(`Transazione "${victim.description}" eliminata`, {
      description: "Verrà rimossa in via definitiva tra pochi secondi.",
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
          .delete({ count: "exact" })
          .in("id", ids);
        if (error) throw error;
        if ((count ?? 0) === 0) {
          throw new Error(
            "Nessuna riga eliminata: probabile RLS. Verifica le policy DELETE su public.transactions."
          );
        }
      } catch (err) {
        restore();
        toast.error("Eliminazione massiva fallita", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBulkBusy(null);
      }
    };

    toast(`${victims.length} transazioni eliminate`, {
      description: "Annulla entro pochi secondi per ripristinarle.",
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
        const inserted = Number(json.report?.inserted ?? 0);
        toast.success(`${account.name} sincronizzato`, {
          id: toastId,
          description:
            inserted > 0
              ? `${inserted} nuove transazioni importate e categorizzate.`
              : "Nessuna nuova transazione: tutto già aggiornato.",
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

      <SummaryCards
        summary={summary}
        monthLabel={monthLabel}
        pocketBalance={pocketBalance}
        previous={previousSummary}
      />

      <AccountsSection
        accounts={accounts}
        loading={loadingAccounts}
        onAdd={() => setConnectOpen(true)}
        onSync={handleSync}
        onEdit={(acc) => setEditingAccount(acc)}
        onCleanupHistory={configured ? handleCleanupHistory : undefined}
        cleaningHistory={cleaningHistory}
        syncingAccountIds={syncingIds}
      />

      <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <SmartSearchBar active={activeQuery} onApply={setActiveQuery} />
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
        </div>
      </div>

      <AddTransaction
        accounts={accounts}
        tagSuggestions={distinctTagSuggestions}
      />

      {loading && displayed.length === 0 ? (
        <div className="card-surface flex items-center justify-center gap-2 p-10 text-[13px] text-[color:var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Caricamento transazioni…
        </div>
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

      <AskAI transactions={displayed} dateRange={dateRange} />

      <EditTransactionModal
        transaction={editing}
        accounts={accounts}
        tagSuggestions={distinctTagSuggestions}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        onDelete={handleDelete}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

/**
 * Applica un filtro Gemini a una query Supabase. I nomi dei metodi
 * riflettono l'API PostgREST:
 *   - eq/gt/lt: confronto diretto
 *   - ilike:    LIKE case-insensitive (value deve già contenere i `%`)
 *   - containedBy: per colonne array (es. tags) → usiamo `contains([value])`
 *     perché semanticamente l'utente cerca righe che *contengono* quel tag.
 *
 * Il cast a `any` è necessario perché i generici di `PostgrestFilterBuilder`
 * (v2.103) sono invasivi; a runtime le chiamate restano corrette perché usiamo
 * solo metodi documentati del client Supabase.
 */
function applySupabaseFilter<Q>(query: Q, filter: QueryFilter): Q {
  const { column, operator, value } = filter;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = query as any;

  switch (operator) {
    case "eq":
      return q.eq(column, value) as Q;
    case "gt":
      return q.gt(column, value) as Q;
    case "lt":
      return q.lt(column, value) as Q;
    case "ilike":
      return q.ilike(column, String(value)) as Q;
    case "containedBy":
      if (column === "tags") {
        return q.contains("tags", [String(value)]) as Q;
      }
      return q.eq(column, value) as Q;
    default:
      return query;
  }
}

/**
 * Valuta localmente se una riga rispetta il filtro.
 * Usata sia per i mock (Supabase non configurato) sia per le UPDATE/INSERT
 * in arrivo dal realtime quando c'è un filtro attivo.
 */
function rowMatchesFilter(row: Transaction, filter: QueryFilter): boolean {
  const raw = (row as unknown as Record<string, unknown>)[filter.column];

  switch (filter.operator) {
    case "eq":
      return String(raw) === String(filter.value);
    case "gt":
      return Number(raw) > Number(filter.value);
    case "lt":
      return Number(raw) < Number(filter.value);
    case "ilike": {
      const pattern = String(filter.value).replace(/%/g, "").toLowerCase();
      return String(raw ?? "").toLowerCase().includes(pattern);
    }
    case "containedBy":
      if (Array.isArray(raw)) {
        return raw
          .map((v) => String(v).toLowerCase())
          .includes(String(filter.value).toLowerCase());
      }
      return false;
    default:
      return true;
  }
}
