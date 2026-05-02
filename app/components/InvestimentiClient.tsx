"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertCircle,
  Gift,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
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
import {
  investmentBonusValue,
  investmentTitoliValue,
  maturityProgressForRow,
  sumInvestmentCountervalues,
} from "@/lib/manual-investment-totals";
import {
  parseStrictDecimal,
  parseStrictDecimalUnbounded,
  parseStrictIntYears,
} from "@/lib/strict-decimal";
import CurrencyCounter from "./premium/CurrencyCounter";
import { FadeUpChild, FadeUpStagger } from "./premium/motion-primitives";
import InvestimentiTableSkeleton from "./premium/InvestimentiTableSkeleton";

const MotionTableRow = motion.tr;

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
  bonus_amount: string;
  maturity_date: string;
  is_manual: boolean;
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
  bonus_amount: "0",
  maturity_date: "",
  is_manual: true,
  notes: "",
});

export default function InvestimentiClient() {
  const configured = isSupabaseConfigured();
  const reduceMotion = useReducedMotion();
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
  const [bonusModalRow, setBonusModalRow] = useState<ManualInvestmentRow | null>(
    null
  );
  const [bonusModalValue, setBonusModalValue] = useState("");
  const [bonusModalSaving, setBonusModalSaving] = useState(false);
  const [positionModalOpen, setPositionModalOpen] = useState(false);
  const [formFieldErrors, setFormFieldErrors] = useState<
    Partial<Record<keyof FormState | "general", string>>
  >({});

  const dismissFormFieldError = (key: keyof FormState | "general") => {
    setFormFieldErrors((fe) => {
      const n = { ...fe };
      delete n[key];
      return n;
    });
  };

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

  const sumTitoli = useMemo(
    () => rows.reduce((s, r) => s + investmentTitoliValue(r), 0),
    [rows]
  );

  const sumBonus = useMemo(
    () => rows.reduce((s, r) => s + investmentBonusValue(r), 0),
    [rows]
  );

  const sumControvalore = useMemo(
    () => sumInvestmentCountervalues(rows),
    [rows]
  );

  const liquidityTotal = useMemo(
    () =>
      computeAccountsTotal(accountsDisplay, { includePockets: true }),
    [accountsDisplay]
  );

  const patrimonioStimato = liquidityTotal + sumControvalore;

  const scenarioPrincipal = useMemo(() => {
    const base = sumControvalore;
    return includeLiquidity ? base + liquidityTotal : base;
  }, [sumControvalore, liquidityTotal, includeLiquidity]);

  const rowsWithMaturity = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.maturity_date != null &&
          String(r.maturity_date).trim() !== "" &&
          maturityProgressForRow(r) != null
      ),
    [rows]
  );

  const { scenario, projectionErrors, projectionNarrateFields } = useMemo(() => {
    const err: string[] = [];
    const pctP = parseStrictDecimalUnbounded(annualPct, {
      label: "Rendimento annuo (%)",
      allowEmpty: true,
    });
    const pmtP = parseStrictDecimalUnbounded(monthlyContrib, {
      label: "Versamento mensile (€)",
      allowEmpty: true,
    });
    const yP = parseStrictIntYears(horizonYears, {
      label: "Orizzonte (anni)",
      min: 1,
      max: 40,
    });
    if (!pctP.ok) err.push(pctP.message);
    if (!pmtP.ok) err.push(pmtP.message);
    if (!yP.ok) err.push(yP.message);
    if (err.length || !pctP.ok || !pmtP.ok || !yP.ok) {
      return {
        scenario: null,
        projectionErrors: err,
        projectionNarrateFields: null,
      };
    }
    const annualReturnPct =
      pctP.value == null && !annualPct.trim() ? 0 : (pctP.value ?? 0);
    const monthlyContribution =
      pmtP.value == null && !monthlyContrib.trim() ? 0 : (pmtP.value ?? 0);
    const scen = computeInvestmentScenario({
      startingPrincipal: scenarioPrincipal,
      annualReturnPct,
      monthlyContribution,
      horizonYears: yP.value,
    });
    return {
      scenario: scen,
      projectionErrors: [] as string[],
      projectionNarrateFields: {
        annualReturnPct,
        monthlyContribution,
        horizonYears: yP.value,
      },
    };
  }, [scenarioPrincipal, annualPct, monthlyContrib, horizonYears]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!configured) return;
    const name = form.name.trim();
    setFormFieldErrors({});
    setError(null);

    const fe: Partial<Record<keyof FormState | "general", string>> = {};
    if (!name) {
      fe.name = "Inserisci un nome per la posizione (es. il nome del fondo o del titolo).";
    }
    const cvP = parseStrictDecimal(form.current_value, {
      label: "Valore titoli (€)",
      required: true,
      min: 0,
      allowNullWhenEmpty: false,
    });
    if (!cvP.ok) fe.current_value = cvP.message;
    const bonusP = parseStrictDecimal(form.bonus_amount, {
      label: "Bonus stimato (€)",
      required: false,
      min: 0,
      allowNullWhenEmpty: true,
    });
    if (!bonusP.ok) fe.bonus_amount = bonusP.message;
    const qtyP = parseStrictDecimal(form.quantity, {
      label: "Quantità",
      required: false,
      min: 0,
      allowNullWhenEmpty: true,
    });
    if (!qtyP.ok) fe.quantity = qtyP.message;
    const apP = parseStrictDecimal(form.avg_price, {
      label: "Prezzo medio (€)",
      required: false,
      min: 0,
      allowNullWhenEmpty: true,
    });
    if (!apP.ok) fe.avg_price = apP.message;
    const isinTrim = form.isin.trim().toUpperCase();
    if (isinTrim && !normalizeIsin(isinTrim)) {
      fe.isin = "ISIN non valido: servono 12 caratteri alfanumerici (es. IE00B4L5Y983).";
    }
    if (Object.keys(fe).length > 0) {
      setFormFieldErrors(fe);
      return;
    }
    if (!cvP.ok || !bonusP.ok || !qtyP.ok || !apP.ok) return;
    if (!name) return;

    const cv = cvP.value!;
    const bonus_amount =
      bonusP.value == null && !form.bonus_amount.trim()
        ? 0
        : (bonusP.value ?? 0);
    const qty = qtyP.value;
    const ap = apP.value;
    setSaving(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sessione non valida.");

      const matTrim = form.maturity_date.trim();
      const maturity_date = matTrim ? matTrim.slice(0, 10) : null;
      const isinNorm = isinTrim ? normalizeIsin(isinTrim) : null;
      const now = new Date().toISOString();
      const payload = {
        name,
        instrument_type: form.instrument_type.trim() || "Altro",
        quantity: qty != null && Number.isFinite(qty) ? qty : null,
        avg_price: ap != null && Number.isFinite(ap) ? ap : null,
        current_value: cv,
        bonus_amount,
        maturity_date,
        isin: isinNorm,
        isin_code: isinNorm,
        is_manual: form.is_manual,
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
      closePositionModal();
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
      if (form.id === id) {
        closePositionModal();
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eliminazione non riuscita.");
    }
  }

  function onEdit(r: ManualInvestmentRow) {
    setQuoteHint(null);
    const md =
      r.maturity_date != null && String(r.maturity_date).trim() !== ""
        ? String(r.maturity_date).slice(0, 10)
        : "";
    const isinDisplay =
      (r.isin?.trim() || r.isin_code?.trim() || "").toUpperCase();
    setForm({
      id: r.id,
      name: r.name,
      instrument_type: r.instrument_type || "Altro",
      isin: isinDisplay,
      quantity:
        r.quantity != null && Number.isFinite(Number(r.quantity))
          ? String(r.quantity)
          : "",
      avg_price:
        r.avg_price != null && Number.isFinite(Number(r.avg_price))
          ? String(r.avg_price)
          : "",
      current_value: String(r.current_value ?? ""),
      bonus_amount: String(
        r.bonus_amount != null && Number.isFinite(Number(r.bonus_amount))
          ? r.bonus_amount
          : 0
      ),
      maturity_date: md,
      is_manual: r.is_manual !== false,
      notes: r.notes ?? "",
    });
  }

  function openAddPositionModal() {
    setQuoteHint(null);
    setForm(emptyForm());
    setFormFieldErrors({});
    setError(null);
    setPositionModalOpen(true);
  }

  function openEditPositionModal(r: ManualInvestmentRow) {
    onEdit(r);
    setFormFieldErrors({});
    setError(null);
    setPositionModalOpen(true);
  }

  function closePositionModal() {
    setPositionModalOpen(false);
    setFormFieldErrors({});
    setQuoteHint(null);
    setError(null);
    setForm(emptyForm());
  }

  useEffect(() => {
    if (!positionModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePositionModal();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [positionModalOpen]);

  function openBonusModal(r: ManualInvestmentRow) {
    setBonusModalRow(r);
    setBonusModalValue(
      String(
        r.bonus_amount != null && Number.isFinite(Number(r.bonus_amount))
          ? r.bonus_amount
          : ""
      )
    );
    setError(null);
  }

  function closeBonusModal() {
    setBonusModalRow(null);
    setBonusModalValue("");
    setBonusModalSaving(false);
    setError(null);
  }

  async function onSaveBonusFromModal() {
    if (!configured || !bonusModalRow) return;
    const parsed = parseStrictDecimal(bonusModalValue, {
      label: "Importo bonus (€)",
      required: true,
      min: 0,
      allowNullWhenEmpty: false,
    });
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    const v = parsed.value!;
    setBonusModalSaving(true);
    setError(null);
    try {
      const supabase = getSupabaseClient();
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("Sessione non valida.");
      const now = new Date().toISOString();
      const { error: histErr } = await supabase.from("bonus_history").insert({
        user_id: uid,
        manual_investment_id: bonusModalRow.id,
        bonus_amount: v,
        source_note: "App Mediolanum / manuale",
      });
      if (histErr) throw histErr;
      const { error: upErr } = await supabase
        .from("manual_investments")
        .update({ bonus_amount: v, updated_at: now })
        .eq("id", bonusModalRow.id);
      if (upErr) throw upErr;
      closeBonusModal();
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Salvataggio bonus non riuscito."
      );
    } finally {
      setBonusModalSaving(false);
    }
  }

  async function fetchIsinQuoteBody(isin: string, quantityStr: string) {
    let quantity: number | undefined;
    if (quantityStr.trim()) {
      const qP = parseStrictDecimal(quantityStr, {
        label: "Quantità",
        required: true,
        min: 0,
        allowNullWhenEmpty: false,
      });
      if (!qP.ok) throw new Error(qP.message);
      const q = qP.value ?? 0;
      if (q > 0) quantity = q;
    }
    const res = await fetch("/api/investments/isin-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        isin,
        quantity,
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
    const isin = (
      r.isin?.trim() ||
      r.isin_code?.trim() ||
      ""
    ).toUpperCase();
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
          is_manual: false,
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
    if (!scenario || !projectionNarrateFields) return;
    setNarrativeBusy(true);
    setNarrative(null);
    setNarrativeSource(null);
    try {
      const res = await fetch("/api/investment-scenario-narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startingPrincipal: scenarioPrincipal,
          ...projectionNarrateFields,
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
            </code>
            ,{" "}
            <code className="rounded bg-[color:var(--color-surface-muted)] px-1 font-mono text-[12px]">
              20260425230000_manual_investments_bonus.sql
            </code>{" "}
            nell&apos;editor SQL.
          </p>
        </div>
      ) : null}

      {error && !positionModalOpen && !bonusModalRow ? (
        <div className="card-surface flex items-start gap-3 border-[color:var(--color-expense)]/30 p-4 text-[13px] text-[color:var(--color-expense)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      ) : null}

      {bonusModalRow ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bonus-modal-title"
        >
          <div className="card-surface relative w-full max-w-md space-y-4 p-6 shadow-xl">
            <button
              type="button"
              onClick={() => closeBonusModal()}
              disabled={bonusModalSaving}
              className="absolute right-3 top-3 rounded-lg p-2 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
              aria-label="Chiudi"
            >
              <X className="h-4 w-4" />
            </button>
            <h3
              id="bonus-modal-title"
              className="pr-10 text-[15px] font-semibold"
            >
              Aggiorna bonus
            </h3>
            <p className="text-[12px] text-[color:var(--color-muted-foreground)] leading-relaxed">
              Posizione:{" "}
              <span className="font-medium text-[color:var(--color-foreground)]">
                {bonusModalRow.name}
              </span>
              . Inserisci l&apos;importo letto dall&apos;app ufficiale Mediolanum
              (o da estratto): viene salvato lo storico in{" "}
              <code className="font-mono text-[11px]">bonus_history</code>.
            </p>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                Bonus stimato (€)
              </label>
              <input
                autoFocus
                inputMode="decimal"
                value={bonusModalValue}
                onChange={(e) => {
                  setBonusModalValue(e.target.value);
                  setError(null);
                }}
                placeholder="es. 1500.00"
                className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums"
                aria-describedby="bonus-modal-amount-hint"
              />
              <p
                id="bonus-modal-amount-hint"
                className="text-[10px] text-[color:var(--color-muted-foreground)]"
              >
                Usa il punto per i decimali (es. 1500.50), non la virgola.
              </p>
            </div>
            {error ? (
              <p className="text-[12px] text-[color:var(--color-expense)]">{error}</p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={bonusModalSaving}
                onClick={() => void onSaveBonusFromModal()}
                className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--color-accent)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
              >
                {bonusModalSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Gift className="h-4 w-4" />
                )}
                Salva
              </button>
              <button
                type="button"
                disabled={bonusModalSaving}
                onClick={() => closeBonusModal()}
                className="rounded-xl border border-[color:var(--color-border)] px-4 py-2 text-[13px] font-medium hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {positionModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="position-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePositionModal();
          }}
        >
          <div
            className="card-surface relative max-h-[min(90vh,900px)] w-full max-w-2xl overflow-y-auto p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => closePositionModal()}
              disabled={saving}
              className="absolute right-3 top-3 rounded-lg p-2 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
              aria-label="Chiudi"
            >
              <X className="h-4 w-4" />
            </button>
            <h3
              id="position-modal-title"
              className="pr-10 text-[15px] font-semibold"
            >
              {form.id ? "Modifica posizione" : "Nuova posizione"}
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--color-muted-foreground)]">
              Indica almeno il <strong className="font-medium text-[color:var(--color-foreground)]">nome</strong> e il{" "}
              <strong className="font-medium text-[color:var(--color-foreground)]">valore titoli attuale (€)</strong>.
              Gli <strong>importi</strong> vanno inseriti con il{" "}
              <strong>punto</strong> come separatore decimale (es. <code className="font-mono">15234.56</code>).
            </p>
            {error && positionModalOpen ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/5 p-3 text-[12px] text-[color:var(--color-expense)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{error}</p>
              </div>
            ) : null}
            <form
              onSubmit={onSave}
              className="mt-4 grid gap-3 sm:grid-cols-2"
            >
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                  Nome
                </label>
                <input
                  value={form.name}
                  onChange={(e) => {
                    dismissFormFieldError("name");
                    setForm((f) => ({ ...f, name: e.target.value }));
                  }}
                  className={`h-10 w-full rounded-xl border bg-[color:var(--color-surface)] px-3 text-[14px] ${
                    formFieldErrors.name
                      ? "border-[color:var(--color-expense)]"
                      : "border-[color:var(--color-border)]"
                  }`}
                  placeholder="es. MSCI World, BTp 2030…"
                />
                {formFieldErrors.name ? (
                  <p className="text-[11px] text-[color:var(--color-expense)]">
                    {formFieldErrors.name}
                  </p>
                ) : null}
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
                      dismissFormFieldError("isin");
                      setForm((f) => ({ ...f, isin: e.target.value }));
                    }}
                    spellCheck={false}
                    autoCapitalize="characters"
                    className={`h-10 min-w-[200px] flex-1 rounded-xl border bg-[color:var(--color-surface)] px-3 font-mono text-[13px] uppercase tracking-wide ${
                      formFieldErrors.isin
                        ? "border-[color:var(--color-expense)]"
                        : "border-[color:var(--color-border)]"
                    }`}
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
                {formFieldErrors.isin ? (
                  <p className="text-[11px] text-[color:var(--color-expense)]">
                    {formFieldErrors.isin}
                  </p>
                ) : quoteHint ? (
                  <p className="text-[11px] leading-snug text-[color:var(--color-muted-foreground)]">
                    {quoteHint}
                  </p>
                ) : (
                  <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                    Con ISIN e quantità compilate: prezzo unitario × quantità per il
                    valore attuale (di solito in EUR). Serve{" "}
                    <code className="font-mono">TWELVE_DATA_API_KEY</code> sul server.
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
                  Valore titoli / attuale (€) <span className="text-[color:var(--color-expense)]">*</span>
                </label>
                <input
                  inputMode="decimal"
                  value={form.current_value}
                  onChange={(e) => {
                    dismissFormFieldError("current_value");
                    setForm((f) => ({ ...f, current_value: e.target.value }));
                  }}
                  placeholder="es. 12500.00"
                  className={`h-10 w-full rounded-xl border bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums ${
                    formFieldErrors.current_value
                      ? "border-[color:var(--color-expense)]"
                      : "border-[color:var(--color-border)]"
                  }`}
                />
                {formFieldErrors.current_value ? (
                  <p className="text-[11px] text-[color:var(--color-expense)]">
                    {formFieldErrors.current_value}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                  Bonus fedeltà stimato (€)
                </label>
                <input
                  inputMode="decimal"
                  value={form.bonus_amount}
                  onChange={(e) => {
                    dismissFormFieldError("bonus_amount");
                    setForm((f) => ({ ...f, bonus_amount: e.target.value }));
                  }}
                  className={`h-10 w-full rounded-xl border bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums ${
                    formFieldErrors.bonus_amount
                      ? "border-[color:var(--color-expense)]"
                      : "border-[color:var(--color-border)]"
                  }`}
                />
                {formFieldErrors.bonus_amount ? (
                  <p className="text-[11px] text-[color:var(--color-expense)]">
                    {formFieldErrors.bonus_amount}
                  </p>
                ) : null}
                <p className="text-[10px] text-[color:var(--color-muted-foreground)]">
                  Dall&apos;estratto; oppure &quot;Bonus&quot; in elenco per la cronologia
                  dettagliata.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                  Scadenza vincolo bonus
                </label>
                <input
                  type="date"
                  value={form.maturity_date}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maturity_date: e.target.value }))
                  }
                  className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                  Quantità (opz., decimale con <span className="font-mono">.</span>)
                </label>
                <input
                  inputMode="decimal"
                  value={form.quantity}
                  onChange={(e) => {
                    dismissFormFieldError("quantity");
                    setForm((f) => ({ ...f, quantity: e.target.value }));
                  }}
                  className={`h-10 w-full rounded-xl border bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums ${
                    formFieldErrors.quantity
                      ? "border-[color:var(--color-expense)]"
                      : "border-[color:var(--color-border)]"
                  }`}
                />
                {formFieldErrors.quantity ? (
                  <p className="text-[11px] text-[color:var(--color-expense)]">
                    {formFieldErrors.quantity}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                  Prezzo medio (opz. €, con <span className="font-mono">.</span>)
                </label>
                <input
                  inputMode="decimal"
                  value={form.avg_price}
                  onChange={(e) => {
                    dismissFormFieldError("avg_price");
                    setForm((f) => ({ ...f, avg_price: e.target.value }));
                  }}
                  className={`h-10 w-full rounded-xl border bg-[color:var(--color-surface)] px-3 text-[14px] tabular-nums ${
                    formFieldErrors.avg_price
                      ? "border-[color:var(--color-expense)]"
                      : "border-[color:var(--color-border)]"
                  }`}
                />
                {formFieldErrors.avg_price ? (
                  <p className="text-[11px] text-[color:var(--color-expense)]">
                    {formFieldErrors.avg_price}
                  </p>
                ) : null}
              </div>
              <div className="sm:col-span-2 flex items-center gap-2 pt-1">
                <input
                  id="inv-is-manual"
                  type="checkbox"
                  checked={form.is_manual}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, is_manual: e.target.checked }))
                  }
                  className="rounded border-[color:var(--color-border)]"
                />
                <label
                  htmlFor="inv-is-manual"
                  className="text-[12px] text-[color:var(--color-muted-foreground)] cursor-pointer"
                >
                  Posizione gestita soprattutto a mano (l&apos;aggiornamento da
                  quotazione sulla riga disattiva questa spunta)
                </label>
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
              <div className="sm:col-span-2 flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={!configured || saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[color:var(--color-accent)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : form.id ? (
                    <Pencil className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {form.id ? "Salva modifiche" : "Aggiungi posizione"}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => closePositionModal()}
                  className="rounded-xl border border-[color:var(--color-border)] px-4 py-2 text-[13px] font-medium hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
                >
                  Annulla
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <FadeUpStagger className="space-y-8">
      <FadeUpChild>
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="card-surface rounded-2xl border border-zinc-800/20 bg-[color:var(--color-surface)]/92 p-5 backdrop-blur-md dark:border-zinc-800/45">
          <p className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            Liquidità (conti + pocket)
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight">
            <CurrencyCounter value={liquidityTotal} />
          </p>
        </div>
        <div className="card-surface rounded-2xl border border-zinc-800/20 bg-[color:var(--color-surface)]/92 p-5 backdrop-blur-md dark:border-zinc-800/45">
          <p className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            Controvalore totale (titoli + bonus)
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight">
            <CurrencyCounter value={sumControvalore} />
          </p>
          <p className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)] tabular-nums">
            Titoli {formatCurrency(sumTitoli)}
            {sumBonus > 0 ? (
              <>
                {" "}
                · Bonus {formatCurrency(sumBonus)}
              </>
            ) : null}
          </p>
        </div>
        <div className="card-surface rounded-2xl border border-zinc-800/20 bg-[color:var(--color-surface)]/92 p-5 ring-1 ring-[color:var(--color-accent)]/25 backdrop-blur-md dark:border-zinc-800/45">
          <p className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
            Patrimonio stimato
          </p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums tracking-tight text-[color:var(--color-accent)]">
            <CurrencyCounter value={patrimonioStimato} />
          </p>
          <p className="mt-2 text-[11px] text-[color:var(--color-muted-foreground)]">
            Somma conti + controvalore posizioni (valore titoli + bonus fedeltà).
            Con ISIN e{" "}
            <code className="font-mono text-[10px]">TWELVE_DATA_API_KEY</code> puoi
            aggiornare dalla quotazione (quantità obbligatoria).
          </p>
        </div>
      </section>
      </FadeUpChild>

      <FadeUpChild>
      <section className="card-surface flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-zinc-800/20 p-5 dark:border-zinc-800/45">
        <div className="min-w-0 max-w-2xl space-y-1">
          <h2 className="text-[15px] font-semibold">Le tue posizioni</h2>
          <p className="text-[12px] leading-relaxed text-[color:var(--color-muted-foreground)]">
            Aggiungi o modifica dal pulsante: ti mostriamo l&apos;anteprima dei
            valori; gli importi accettano solo il punto decimale (es.{" "}
            <code className="font-mono">1234.56</code>).
          </p>
        </div>
        <button
          type="button"
          onClick={openAddPositionModal}
          disabled={!configured}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[color:var(--color-accent)] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Nuova posizione
        </button>
      </section>
      </FadeUpChild>

      <FadeUpChild>
      <section className="card-surface overflow-visible rounded-2xl border border-zinc-800/20 dark:border-zinc-800/45">
        <div className="border-b border-[color:var(--color-border)] px-5 py-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold">Elenco posizioni</h2>
          <button
            type="button"
            onClick={openAddPositionModal}
            disabled={!configured}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--color-foreground)] hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuova posizione
          </button>
        </div>
        {loading ? (
          <InvestimentiTableSkeleton />
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-[13px] text-[color:var(--color-muted-foreground)]">
            Nessuna posizione inserita. Tocca{" "}
            <strong className="text-[color:var(--color-foreground)]">Nuova posizione</strong> per aprire il
            pannello e inserirne una.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[13px]">
              <thead className="bg-[color:var(--color-surface-muted)]/50 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
                <tr>
                  <th className="px-4 py-2">Nome</th>
                  <th className="px-4 py-2 font-mono normal-case">ISIN</th>
                  <th className="px-4 py-2">Tipo</th>
                  <th className="px-4 py-2 text-right">Titoli</th>
                  <th className="px-4 py-2 text-right">Bonus</th>
                  <th className="px-4 py-2 text-right">Controvalore</th>
                  <th className="px-4 py-2 text-right">Q.tà</th>
                  <th className="px-4 py-2 text-right">Prezzo medio</th>
                  <th className="px-4 py-2 w-40" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rowIsin = (
                    r.isin?.trim() ||
                    r.isin_code?.trim() ||
                    ""
                  ).toUpperCase();
                  const rowIsinOk = Boolean(
                    rowIsin && normalizeIsin(rowIsin)
                  );
                  return (
                  <MotionTableRow
                    key={r.id}
                    layout={false}
                    initial={false}
                    whileHover={
                      reduceMotion
                        ? undefined
                        : {
                            scale: 1.02,
                            transition: { duration: 0.18, ease: "easeOut" },
                          }
                    }
                    whileTap={
                      reduceMotion
                        ? undefined
                        : { scale: 0.985, transition: { duration: 0.12 } }
                    }
                    style={{ transformOrigin: "center left" }}
                    className="border-t border-[color:var(--color-border)] transition-colors hover:bg-zinc-800/12 active:bg-zinc-800/18 dark:hover:bg-zinc-800/35 dark:active:bg-zinc-800/45"
                  >
                    <td className="px-4 py-2.5 font-medium">{r.name}</td>
                    <td className="px-4 py-2.5 font-mono text-[11px] text-[color:var(--color-muted-foreground)]">
                      {rowIsin ? rowIsin : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[color:var(--color-muted-foreground)]">
                      {r.instrument_type}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatCurrency(investmentTitoliValue(r))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--color-muted-foreground)]">
                      {formatCurrency(investmentBonusValue(r))}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[color:var(--color-accent)]">
                      {formatCurrency(
                        investmentTitoliValue(r) + investmentBonusValue(r)
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--color-muted-foreground)]">
                      {r.quantity != null ? r.quantity : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--color-muted-foreground)]">
                      {r.avg_price != null ? formatCurrency(Number(r.avg_price)) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openBonusModal(r)}
                          className="rounded-lg px-2 py-1 text-[11px] font-medium text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)]"
                          title="Aggiorna bonus da app Mediolanum"
                        >
                          <span className="inline-flex items-center gap-1">
                            <Gift className="h-3.5 w-3.5" />
                            Bonus
                          </span>
                        </button>
                        {rowIsinOk ? (
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
                          onClick={() => openEditPositionModal(r)}
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
                  </MotionTableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </FadeUpChild>

      {rowsWithMaturity.length > 0 ? (
        <FadeUpChild>
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold px-1">
            Vincolo bonus e scadenza
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {rowsWithMaturity.map((r) => {
              const prog = maturityProgressForRow(r);
              if (!prog) return null;
              const bonus = investmentBonusValue(r);
              const matLabel =
                r.maturity_date != null
                  ? String(r.maturity_date).slice(0, 10)
                  : "";
              return (
                <div
                  key={r.id}
                  className="card-surface space-y-3 rounded-2xl border border-zinc-800/20 p-5 dark:border-zinc-800/45"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[13px] font-semibold">{r.name}</p>
                      <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                        Scadenza vincolo:{" "}
                        <span className="font-mono tabular-nums">{matLabel}</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                        {prog.isPast ? "Scadenza" : "Mancano"}
                      </p>
                      <p
                        className={`text-[20px] font-bold tabular-nums leading-none ${
                          prog.isPast
                            ? "text-[color:var(--color-muted-foreground)]"
                            : "text-[color:var(--color-accent)]"
                        }`}
                      >
                        {prog.isPast ? "—" : `${prog.daysRemaining}`}
                        {!prog.isPast ? (
                          <span className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
                            {" "}
                            gg
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
                      <div
                        className="h-full rounded-full bg-[color:var(--color-accent)] transition-[width] duration-300"
                        style={{ width: `${prog.progressPct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                      Avanzamento verso la data di maturazione del bonus.
                    </p>
                  </div>
                  {bonus > 0 ? (
                    <p className="rounded-lg border border-[color:var(--color-accent)]/25 bg-[color:var(--color-accent)]/5 px-3 py-2 text-[12px] leading-snug text-[color:var(--color-foreground)]">
                      <span className="font-semibold text-[color:var(--color-accent)]">
                        Guadagno extra stimato: {formatCurrency(bonus)}
                      </span>
                      {prog.isPast
                        ? " — importo registrato; verifica in app se il bonus è maturato."
                        : " — rispettando il vincolo fino alla scadenza, questo importo si aggiunge al controvalore totale (oltre al valore titoli)."}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
                      Imposta l&apos;importo bonus con &quot;Aggiorna bonus&quot;
                      per vedere il controvalore extra alla scadenza.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        </FadeUpChild>
      ) : null}

      <FadeUpChild>
      <section className="card-surface space-y-4 rounded-2xl border border-zinc-800/20 p-6 dark:border-zinc-800/45">
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
        <p className="text-[10px] text-[color:var(--color-muted-foreground)] -mt-1 sm:-mt-2">
          Nei campi in € e in % usa il punto per i decimali (niente virgola). L&apos;orizzonte è un numero
          intero (anni).
        </p>
        {projectionErrors.length > 0 ? (
          <div className="space-y-1 rounded-xl border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/5 p-3 text-[12px] text-[color:var(--color-expense)]">
            {projectionErrors.map((msg) => (
              <p key={msg}>{msg}</p>
            ))}
          </div>
        ) : null}

        <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 p-4 text-[13px] space-y-1">
          <p>
            <span className="text-[color:var(--color-muted-foreground)]">
              Capitale iniziale scenario:
            </span>{" "}
            <span className="font-semibold tabular-nums">
              <CurrencyCounter value={scenarioPrincipal} />
            </span>
          </p>
          {scenario ? (
            <>
              <p>
                <span className="text-[color:var(--color-muted-foreground)]">
                  Valore finale stimato:
                </span>{" "}
                <span className="font-semibold tabular-nums text-[color:var(--color-accent)]">
                  <CurrencyCounter value={scenario.endValue} />
                </span>
              </p>
              <p>
                <span className="text-[color:var(--color-muted-foreground)]">
                  Versamenti cumulati nel periodo:
                </span>{" "}
                <span className="font-medium tabular-nums">
                  <CurrencyCounter value={scenario.totalContributions} />
                </span>
              </p>
              <p>
                <span className="text-[color:var(--color-muted-foreground)]">
                  Effetto rendimento (stima):
                </span>{" "}
                <span className="font-medium tabular-nums">
                  <CurrencyCounter value={scenario.marketComponent} />
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
      </FadeUpChild>
      </FadeUpStagger>
    </div>
  );
}
