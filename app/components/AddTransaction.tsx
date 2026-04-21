"use client";

import { useState, useTransition } from "react";
import {
  Plus,
  Sparkles,
  Loader2,
  AlertCircle,
  Repeat,
  Tag,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import type { Account } from "@/lib/mock-data";
import {
  TRANSACTION_CATEGORIES,
  type TransactionCategory,
  type TransactionAnalysis,
} from "@/lib/gemini";

type Status =
  | { kind: "idle" }
  | { kind: "suggesting" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

type AddTransactionProps = {
  accounts?: Account[];
};

export default function AddTransaction({
  accounts = [],
}: AddTransactionProps) {
  const [description, setDescription] = useState("");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState<TransactionCategory | "">("");
  const [accountId, setAccountId] = useState<string | "">("");
  const [analysis, setAnalysis] = useState<TransactionAnalysis | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setDescription("");
    setMerchant("");
    setAmount("");
    setCategory("");
    setAccountId("");
    setAnalysis(null);
    setType("expense");
  };

  async function fetchAnalysis(): Promise<TransactionAnalysis | null> {
    if (!description.trim()) {
      setStatus({
        kind: "error",
        message: "Inserisci una descrizione prima di chiedere un suggerimento.",
      });
      return null;
    }

    setStatus({ kind: "suggesting" });
    try {
      const res = await fetch("/api/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = (await res.json()) as Partial<TransactionAnalysis> & {
        error?: string;
      };
      if (!res.ok || !data.category) {
        throw new Error(data.error ?? "Impossibile analizzare la transazione.");
      }

      const full: TransactionAnalysis = {
        category: data.category,
        merchant: data.merchant ?? "",
        tags: data.tags ?? [],
        is_subscription: Boolean(data.is_subscription),
      };

      setAnalysis(full);
      setCategory(full.category);
      if (!merchant.trim() && full.merchant) {
        setMerchant(full.merchant);
      }
      setStatus({ kind: "idle" });
      return full;
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Errore IA.",
      });
      return null;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const parsedAmount = Number.parseFloat(amount.replace(",", "."));
    if (!description.trim()) {
      setStatus({ kind: "error", message: "La descrizione è obbligatoria." });
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setStatus({ kind: "error", message: "Inserisci un importo valido." });
      return;
    }

    let finalCategory: TransactionCategory = category || "Altro";
    let finalAnalysis: TransactionAnalysis | null = analysis;
    if (!category || !analysis) {
      const result = await fetchAnalysis();
      if (result) {
        finalCategory = result.category;
        finalAnalysis = result;
      }
    }

    setStatus({ kind: "saving" });
    startTransition(async () => {
      try {
        const supabase = getSupabaseClient();
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr || !user) {
          throw new Error("Devi essere autenticato per aggiungere transazioni.");
        }

        const signedAmount =
          type === "expense" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);

        const { error } = await supabase.from("transactions").insert({
          description: description.trim(),
          merchant: merchant.trim() || null,
          category: finalCategory,
          amount: signedAmount,
          tags: finalAnalysis?.tags ?? [],
          is_subscription: finalAnalysis?.is_subscription ?? false,
          account_id: accountId || null,
          user_id: user.id,
        });

        if (error) throw error;

        reset();
        setStatus({ kind: "idle" });
      } catch (err) {
        setStatus({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Impossibile salvare la transazione.",
        });
      }
    });
  }

  const isBusy =
    status.kind === "suggesting" || status.kind === "saving" || pending;

  return (
    <section className="card-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight">
            Aggiungi transazione
          </h2>
          <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
            Gemini analizza la descrizione: categoria, esercente, tag e abbonamenti.
          </p>
        </div>
        <Sparkles className="h-4 w-4 text-[color:var(--color-accent)]" />
      </div>

      <form onSubmit={onSubmit} className="mt-5 grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-5">
          <Label>Descrizione</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description.trim() && !analysis) fetchAnalysis();
            }}
            placeholder="Es. Abbonamento mensile Netflix"
            required
          />
        </div>

        <div className="md:col-span-3">
          <Label>Esercente</Label>
          <Input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder={analysis?.merchant || "Es. Esselunga"}
          />
        </div>

        <div className="md:col-span-2">
          <Label>Importo</Label>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            required
          />
        </div>

        <div className="md:col-span-2">
          <Label>Tipo</Label>
          <div className="flex rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] p-1 text-[12px] font-medium">
            <ToggleChip
              active={type === "expense"}
              onClick={() => setType("expense")}
            >
              Uscita
            </ToggleChip>
            <ToggleChip
              active={type === "income"}
              onClick={() => setType("income")}
            >
              Entrata
            </ToggleChip>
          </div>
        </div>

        {accounts.length > 0 ? (
          <div className="md:col-span-12">
            <Label>Conto</Label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors focus:border-[color:var(--color-accent)]"
            >
              <option value="">— Nessuno —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.type ? ` · ${a.type}` : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="md:col-span-8">
          <Label>
            Categoria
            {status.kind === "suggesting" ? (
              <span className="ml-2 inline-flex items-center gap-1 text-[color:var(--color-accent)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Gemini sta analizzando…
              </span>
            ) : null}
          </Label>
          <div className="flex items-center gap-2">
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as TransactionCategory)
              }
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors focus:border-[color:var(--color-accent)]"
            >
              <option value="">Suggerita da Gemini</option>
              {TRANSACTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={fetchAnalysis}
              disabled={isBusy || !description.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-10 text-[13px] font-medium transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-[color:var(--color-accent)]" />
              Analizza
            </button>
          </div>
        </div>

        <div className="md:col-span-4 flex items-end">
          <button
            type="submit"
            disabled={isBusy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--color-foreground)] px-4 h-10 text-[14px] font-semibold text-[color:var(--color-background)] transition-opacity disabled:opacity-50"
          >
            {status.kind === "saving" || pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvataggio…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                Aggiungi
              </>
            )}
          </button>
        </div>

        {analysis && (analysis.tags.length > 0 || analysis.is_subscription) ? (
          <div className="md:col-span-12 flex flex-wrap items-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/60 px-3 py-2.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
              <Sparkles className="h-3 w-3 text-[color:var(--color-accent)]" />
              Gemini
            </span>
            {analysis.is_subscription ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-accent)]/12 px-2 py-1 text-[11px] font-semibold text-[color:var(--color-accent)]">
                <Repeat className="h-3 w-3" />
                Abbonamento ricorrente
              </span>
            ) : null}
            {analysis.tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 py-1 text-[11px] font-medium text-[color:var(--color-foreground)]"
              >
                <Tag className="h-3 w-3 text-[color:var(--color-muted-foreground)]" />
                {t}
              </span>
            ))}
          </div>
        ) : null}

        {status.kind === "error" ? (
          <div className="md:col-span-12 flex items-center gap-2 rounded-xl border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/8 px-3 py-2 text-[13px] text-[color:var(--color-expense)]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{status.message}</span>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)]"
    />
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-1 rounded-lg px-2 py-1.5 transition-colors",
        active
          ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-sm"
          : "text-[color:var(--color-muted-foreground)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
