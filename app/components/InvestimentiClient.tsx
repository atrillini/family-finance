"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import {
  computeAccountsTotal,
  formatCurrency,
  MOCK_ACCOUNTS,
  type Account,
} from "@/lib/mock-data";
import type { ManualInvestmentRow } from "@/lib/supabase";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { computeInvestmentScenario } from "@/lib/investment-projection";
import { normalizeIsin } from "@/lib/twelve-data-quote";
import { fetchCashLedgerTotals } from "@/lib/cash-ledger";
import { isCashWalletAccount } from "@/lib/cash-wallet";

const INSTRUMENT_TYPES = [
  "Fondo",
  "Azione",
  "ETF",
  "Polizza",
  "Crypto",
  "Obbligazione",
  "Altro",
] as const;

type FormState = {
  id: string | null;
  name: string;
  instrument_type: string;
  isin: string;
  quantity: string;
  avg_price: string;
  current_value: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  id: null,
  name: "",
  instrument_type: "Altro",
  isin: "",
  quantity: "",
  avg_price: "",
  current_value: "",
  notes: "",
});

export default function InvestimentiClient() {
  const configured = isSupabaseConfigured();
  const [accounts, setAccounts] = useState<Account[]>(MOCK_ACCOUNTS);
  const [cashLedger, setCashLedger] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<ManualInvestmentRow[]>([]);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  const [saving, setSaving] = useState(false);
  const [formQuoteBusy, setFormQuoteBusy] = useState(false);
  const [quoteHint, setQuoteHint] = useState<string | null>(null);
  const [rowQuoteBusyId, setRowQuoteBusyId] = useState<string | null>(null);

  const [includeLiquidity, setIncludeLiquidity] = useState(false);
  const [annualPct, setAnnualPct] = useState("4");
  const [monthlyContrib, setMonthlyContrib] = useState("0");
  const [horizonYears, setHorizonYears] = useState("10");
  const [narrative, setNarrative] = useState<string | null>(null);
  const [narrativeSource, setNarrativeSource] = useState<
    "gemini" | "fallback" | null
  >(null);
  const [narrativeBusy, setNarrativeBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!configured) {
      setAccounts(MOCK_ACCOUNTS);
      setCashLedger({});
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const [accRes, invRes] = await Promise.all([
        supabase.from("accounts").select("*").order("name"),
        supabase
          .from("manual_investments")
          .select("*")
          .order("updated_at", { ascending: false }),
      ]);
      if (accRes.error) throw accRes.error;
      if (invRes.error) throw invRes.error;
      const accList = (accRes.data ?? []) as Account[];
      setAccounts(accList);
      const cashIds = accList.filter(isCashWalletAccount).map((a) => a.id);
      if (cashIds.length > 0) {
        const totals = await fetchCashLedgerTotals(supabase, cashIds);
        setCashLedger(totals);
      } else {
        setCashLedger({});
      }
      setRows((invRes.data ?? []) as ManualInvestmentRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di caricamento.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [configured]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const accountsDisplay = useMemo(
    () =>
      accounts.map((a) => {
        if (!isCashWalletAccount(a)) return a;
        if (!Object.prototype.hasOwnProperty.call(cashLedger, a.id)) return a;
        return { ...a, balance: cashLedger[a.id]! };
      }),
    [accounts, cashLedger]
  );

  const sumInvestments = useMemo(
    () =>
      rows.reduce((s, r) => s + Math.max(0, Number(r.current_value) || 0), 0),
    [rows]
  );

  const liquidityTotal = useMemo(
    () =>
      computeAccountsTotal(accountsDisplay, { includePockets: true }),
    [accountsDisplay]
  );

  const patrimonioStimato = liquidityTotal + sumInvestments;

  const scenarioPrincipal = useMemo(() => {
    const base = sumInvestments;
    return includeLiquidity ? base + liquidityTotal : base;
  }, [sumInvestments, liquidityTotal, includeLiquidity]);

  const scenario = useMemo(() => {
    const years = Number(horizonYears);
    const pct = Number(annualPct.replace(",", "."));
    const pmt = Number(monthlyContrib.replace(",", "."));
    return computeInvestmentScenario({
      startingPrincipal: scenarioPrincipal,
      annualReturnPct: Number.isFinite(pct) ? pct : 0,
      monthlyContribution: Number.isFinite(pmt) ? pmt : 0,
      horizonYears: Number.isFinite(years) ? years : 10,
    });
  }, [scenarioPrincipal, annualPct, monthlyContrib, horizonYears]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!configured) return;
    const name = form.name.trim();
    const cv = Number(form.current_value.replace(",", "."));
    if (!name || !Number.isFinite(cv) || cv < 0) return;
    const isinTrim = form.isin.trim().toUpperCase();
    if (isinTrim && !normalizeIsin(isinTrim)) {
      setError("ISIN non valido (12 caratteri, es. IE00B4L5Y983).");
      return;
    }
    const qty = form.quantity.trim()
      ? Number(form.quantity.replace(",", "."))
      : null;
    const ap = form.avg_price.trim()
      ? Number(form.avg_price.replace(",", "."))
      : null;
    setSaving(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sessione non valida.");

      const now = new Date().toISOString();
      const payload = {
        name,
        instrument_type: form.instrument_type.trim() || "Altro",
        quantity: qty != null && Number.isFinite(qty) ? qty : null,
        avg_price: ap != null && Number.isFinite(ap) ? ap : null,
        current_value: cv,
        isin: isinTrim ? normalizeIsin(isinTrim) : null,
        notes: form.notes.trim() || null,
        updated_at: now,
      };

      if (form.id) {
        const { error: upErr } = await supabase
          .from("manual_investments")
          .update(payload)
          .eq("id", form.id);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase
          .from("manual_investments")
          .insert({ ...payload, user_id: uid });
        if (insErr) throw insErr;
      }
      setForm(emptyForm());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Salvataggio non riuscito.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!configured) return;
    if (!window.confirm("Eliminare questa posizione?")) return;
    try {
      const supabase = getSupabaseClient();
      const { error: delErr } = await supabase
        .from("manual_investments")
        .delete()
        .eq("id", id);
      if (delErr) throw delErr;
      if (form.id === id) setForm(emptyForm());
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eliminazione non riuscita.");
    }
  }

  function onEdit(r: ManualInvestmentRow) {
    setQuoteHint(null);
    setForm({
      id: r.id,
      name: r.name,
      instrument_type: r.instrument_type || "Altro",
      isin: r.isin?.trim() ? r.isin.trim().toUpperCase() : "",
      quantity:
        r.quantity != null && Number.isFinite(Number(r.quantity))
          ? String(r.quantity)
          : "",
      avg_price:
        r.avg_price != null && Number.isFinite(Number(r.avg_price))
          ? String(r.avg_price)
          : "",
      current_value: String(r.current_value ?? ""),
      notes: r.notes ?? "",
    });
  }

  async function fetchIsinQuoteBody(isin: string, quantityStr: string) {
    const qty = quantityStr.trim()
      ? Number(quantityStr.replace(",", "."))
      : null;
    const res = await fetch("/api/investments/isin-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isin,
        quantity:
          qty != null && Number.isFinite(qty) && qty > 0 ? qty : undefined,
      }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      quote?: {
        unitPrice: number;
        currency: string;
        symbol: string;
        micCode: string;
        instrumentName: string;
        quotedAt: string;
      };
      currentValue?: number | null;
    };
    if (!res.ok || !json.ok) {
      throw new Error(json.error ?? "Quotazione non disponibile.");
    }
    return json;
  }

  async function onQuoteFromForm() {
    if (!configured) return;
    const isin = form.isin.trim().toUpperCase();
    if (!normalizeIsin(isin)) {
      setError("Inserisci un ISIN valido (12 caratteri).");
      setQuoteHint(null);
      return;
    }
    setFormQuoteBusy(true);
    setError(null);
    setQuoteHint(null);
    try {
      const json = await fetchIsinQuoteBody(isin, form.quantity);
      if (json.currentValue != null && Number.isFinite(json.currentValue)) {
        setForm((f) => ({
          ...f,
          current_value: String(json.currentValue),
        }));
        const q = json.quote;
        setQuoteHint(
          q
            ? `Fonte: ${q.symbol} · ${q.micCode} · ${q.currency} · agg. ${q.quotedAt}`
            : null
        );
      } else if (json.quote) {
        const q = json.quote;
        setQuoteHint(
          `Ultimo prezzo unitario: ${q.unitPrice} ${q.currency} (${q.symbol}, ${q.micCode}). Inserisci la quantità e premi di nuovo per calcolare il valore attuale.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore quotazione.");
    } finally {
      setFormQuoteBusy(false);
    }
  }

  async function onQuoteFromRow(r: ManualInvestmentRow) {
    if (!configured) return;
    const isin = r.isin?.trim().toUpperCase() ?? "";
    if (!normalizeIsin(isin)) {
      setError("Salva prima un ISIN valido su questa posizione.");
      return;
    }
    const qty = Number(r.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Serve una quantità > 0 per aggiornare il valore dalla quotazione.");
      return;
    }
    setRowQuoteBusyId(r.id);
    setError(null);
    try {
      const json = await fetchIsinQuoteBody(
        isin,
        r.quantity != null ? String(r.quantity) : ""
      );
      if (json.currentValue == null || !Number.isFinite(json.currentValue)) {
        throw new Error("Risposta quotazione incompleta.");
      }
      const supabase = getSupabaseClient();
      const now = new Date().toISOString();
      const { error: upErr } = await supabase
        .from("manual_investments")
        .update({
          current_value: json.currentValue,
          updated_at: now,
        })
        .eq("id", r.id);
      if (upErr) throw upErr;
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aggiornamento non riuscito.");
    } finally {
      setRowQuoteBusyId(null);
    }
  }

  async function requestNarrative() {
    if (!scenario) return;
    setNarrativeBusy(true);
    setNarrative(null);
    setNarrativeSource(null);
    try {
      const res = await fetch("/api/investment-scenario-narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startingPrincipal: scenarioPrincipal,
          annualReturnPct: Number(annualPct.replace(",", ".")) || 0,
          monthlyContribution: Number(monthlyContrib.replace(",", ".")) || 0,
          horizonYears: Number(horizonYears) || 10,
          endValue: scenario.endValue,
          totalContributions: scenario.totalContributions,
          marketComponent: scenario.marketComponent,
          includeLiquidityInPrincipal: includeLiquidity,
        }),
      });
      const json = (await res.json()) as {
        narrative?: string;
        source?: "gemini" | "fallback";
      };
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Errore");
      setNarrative(typeof json.narrative === "string" ? json.narrative : null);
      setNarrativeSource(json.source ?? "fallback");
    } catch {
      setNarrative(
        "Impossibile generare il testo in questo momento. I numeri della tabella restano validi come simulazione interna."
      );
      setNarrativeSource("fallback");
    } finally {
      setNarrativeBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {!configured ? (
        <div className="card-surface flex items-start gap-3 p-4 text-[13px]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--color-accent)]" />
          <p className="text-[color:var(--color-muted-foreground)]">
            Supabase non è configurato: vedi solo i saldi di esempio e la
            simulazione; per salvare le posizioni collega il progetto e applica
            le migrazioni SQL{" "}
            <code className="rounded bg-[color:var(--color-surface-muted)] px-1 font-mono text-[12px]">
              20260425200000_manual_investments.sql
            </code>{" "}
            e{" "}
            <code className="rounded bg-[color:var(--color-surface-muted)] px-1 font-mono text-[12px]">
              20260425211000_manual_investments_isin.sql
            </code>{" "}
            nell&apos;editor SQL.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="card-surface flex items-start gap-3 border-[color:var(--color-expense)]/30 p-4 text-[13px] text-[color:var(--color-expense)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card-surface p-5">
          <p className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            Liquidità (conti + pocket)
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight">
            {formatCurrency(liquidityTotal)}
          </p>
        </div>
        <div className="card-surface p-5">
          <p className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            Investimenti manuali
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight">
            {formatCurrency(sumInvestments)}
          </p>
        </div>
        <div className="card-surface p-5 ring-1 ring-[color:var(--color-accent)]/25">
          <p className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            Patrimonio stimato
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight text-[color:var(--color-accent)]">
            {formatCurrency(patrimonioStimato)}
          </p>
          <p className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)]">
            Somma conti + valore attuale posizioni. Con ISIN e{" "}
            <code className="font-mono text-[10px]">TWELVE_DATA_API_KEY</code> puoi
            aggiornare dalla quotazione (quantità obbligatoria).
          </p>
        </div>
      </section>

      <section className="card-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">
            {form.id ? "Modifica posizione" : "Nuova posizione"}
          </h2>
          {form.id ? (
            <button
              type="button"
              onClick={() => setForm(emptyForm())}
              className="text-[12px] font-medium text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
            >
              Annulla modifica
            </button>
          ) : null}
        </div>
        <form onSubmit={onSave} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2 space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              Nome
            </label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px]"
              placeholder="es. MSCI World, BTp 2030…"
            />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              ISIN (opz., quotazione Twelve Data)
            </label>
            <div className="flex flex-wrap items-stretch gap-2">
              <input
                value={form.isin}
                onChange={(e) => {
                  setQuoteHint(null);
                  setForm((f) => ({ ...f, isin: e.target.value }));
                }}
                spellCheck={false}
                autoCapitalize="characters"
                className="h-10 min-w-[200px] flex-1 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 font-mono text-[13px] uppercase tracking-wide"
                placeholder="es. IE00B4L5Y983"
              />
              <button
                type="button"
                disabled={!configured || formQuoteBusy}
                onClick={() => void onQuoteFromForm()}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] px-3 text-[12px] font-medium hover:bg-[color:var(--color-surface-muted)]/80 disabled:opacity-50"
              >
                {formQuoteBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Aggiorna da mercato
              </button>
            </div>
            {quoteHint ? (
              <p className="text-[11px] leading-snug text-[color:var(--color-muted-foreground)]">
                {quoteHint}
              </p>
            ) : (
              <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                Con quantità compilata: imposta il valore attuale come prezzo ×
                quantità (valuta del listino scelto, di solito EUR).
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              Tipo
            </label>
            <select
              value={form.instrument_type}
              onChange={(e) =>
                setForm((f) => ({ ...f, instrument_type: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px]"
            >
              {INSTRUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              Valore attuale (€) *
            </label>
            <input
              required
              inputMode="decimal"
              value={form.current_value}
              onChange={(e) =>
                setForm((f) => ({ ...f, current_value: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              Quantità (opz.)
            </label>
            <input
              inputMode="decimal"
              value={form.quantity}
              onChange={(e) =>
                setForm((f) => ({ ...f, quantity: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              Prezzo medio (opz.)
            </label>
            <input
              inputMode="decimal"
              value={form.avg_price}
              onChange={(e) =>
                setForm((f) => ({ ...f, avg_price: e.target.value }))
              }
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums"
            />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              Note
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px]"
            />
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={!configured || saving}
              className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--color-accent)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {form.id ? "Salva modifiche" : "Aggiungi posizione"}
            </button>
          </div>
        </form>
      </section>

      <section className="card-surface overflow-hidden">
        <div className="border-b border-[color:var(--color-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold">Elenco posizioni</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-[color:var(--color-muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Caricamento…
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-[color:var(--color-muted-foreground)]">
            Nessuna posizione inserita. Usa il form sopra per aggiungerne una.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="bg-[color:var(--color-surface-muted)]/50 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-2">Nome</th>
                  <th className="px-4 py-2 font-mono normal-case">ISIN</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2 text-right">Valore</th>
                  <th className="px-4 py-2 text-right">Q.tà</th>
                  <th className="px-4 py-2 text-right">Prezzo medio</th>
                  <th className="px-4 py-2 w-32" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-[color:var(--color-border)]"
                  >
                    <td className="px-4 py-2.5 font-medium">{r.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
                      {r.isin?.trim() ? r.isin.trim().toUpperCase() : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[color:var(--color-muted-foreground)]">
                      {r.instrument_type}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatCurrency(Number(r.current_value))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--color-muted-foreground)]">
                      {r.quantity != null ? r.quantity : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--color-muted-foreground)]">
                      {r.avg_price != null ? formatCurrency(Number(r.avg_price)) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {r.isin?.trim() && normalizeIsin(r.isin) ? (
                          <button
                            type="button"
                            disabled={rowQuoteBusyId === r.id}
                            onClick={() => void onQuoteFromRow(r)}
                            className="rounded-lg p-1.5 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)] disabled:opacity-50"
                            title="Ricalcola valore da quotazione (ISIN × quantità)"
                            aria-label="Aggiorna quotazione"
                          >
                            {rowQuoteBusyId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onEdit(r)}
                          className="rounded-lg p-1.5 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
                          aria-label="Modifica"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDelete(r.id)}
                          className="rounded-lg p-1.5 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-expense)]/10 hover:text-[color:var(--color-expense)]"
                          aria-label="Elimina"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-surface p-6 space-y-4">
        <h2 className="text-[15px] font-semibold">Proiezione (solo simulazione)</h2>
        <p className="text-[12px] text-[color:var(--color-muted-foreground)] leading-relaxed">
          I numeri sotto sono calcolati in modo **deterministico** nell&apos;app
          (rendimento annuo nominale composto mensilmente + versamento fisso a
          fine mese). Non include tasse, commissioni o andamenti reali dei
          mercati. Il pulsante Gemini genera solo una **descrizione narrativa** di
          questi numeri, non consulenza finanziaria.
        </p>

        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={includeLiquidity}
            onChange={(e) => setIncludeLiquidity(e.target.checked)}
            className="rounded border-[color:var(--color-border)]"
          />
          <span>
            Includi liquidità conti nel capitale iniziale dello scenario (
            {formatCurrency(liquidityTotal)})
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              Rendimento annuo ipotizzato (%)
            </label>
            <input
              inputMode="decimal"
              value={annualPct}
              onChange={(e) => setAnnualPct(e.target.value)}
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              Versamento mensile (€)
            </label>
            <input
              inputMode="decimal"
              value={monthlyContrib}
              onChange={(e) => setMonthlyContrib(e.target.value)}
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              Orizzonte (anni)
            </label>
            <input
              inputMode="numeric"
              value={horizonYears}
              onChange={(e) => setHorizonYears(e.target.value)}
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums"
            />
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 p-4 text-[13px] space-y-1">
          <p>
            <span className="text-[color:var(--color-muted-foreground)]">
              Capitale iniziale scenario:
            </span>{" "}
            <span className="font-semibold tabular-nums">
              {formatCurrency(scenarioPrincipal)}
            </span>
          </p>
          {scenario ? (
            <>
              <p>
                <span className="text-[color:var(--color-muted-foreground)]">
                  Valore finale stimato:
                </span>{" "}
                <span className="font-semibold tabular-nums text-[color:var(--color-accent)]">
                  {formatCurrency(scenario.endValue)}
                </span>
              </p>
              <p>
                <span className="text-[color:var(--color-muted-foreground)]">
                  Versamenti cumulati nel periodo:
                </span>{" "}
                <span className="font-medium tabular-nums">
                  {formatCurrency(scenario.totalContributions)}
                </span>
              </p>
              <p>
                <span className="text-[color:var(--color-muted-foreground)]">
                  Effetto rendimento (stima):
                </span>{" "}
                <span className="font-medium tabular-nums">
                  {formatCurrency(scenario.marketComponent)}
                </span>
              </p>
            </>
          ) : (
            <p className="text-[color:var(--color-muted-foreground)]">
              Imposta parametri validi per vedere la simulazione.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void requestNarrative()}
            disabled={!configured || !scenario || narrativeBusy}
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border)] px-4 py-2 text-[12.5px] font-medium transition-colors hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)] disabled:opacity-50"
          >
            {narrativeBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Commento Gemini sui numeri
          </button>
          {narrativeSource ? (
            <span className="text-[11px] text-[color:var(--color-muted-foreground)]">
              Fonte: {narrativeSource === "gemini" ? "Gemini" : "testo interno"}
            </span>
          ) : null}
        </div>

        {narrative ? (
          <div className="ai-answer rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-3 text-[13px] leading-relaxed">
            <ReactMarkdown>{narrative}</ReactMarkdown>
          </div>
        ) : null}
      </section>
    </div>
  );
}
