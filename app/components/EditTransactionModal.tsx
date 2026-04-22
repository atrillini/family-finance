"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  Loader2,
  Repeat,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Account, Transaction } from "@/lib/mock-data";
import {
  TRANSACTION_CATEGORIES,
  type TransactionCategory,
} from "@/lib/gemini";
import TagsInput from "./TagsInput";

export type EditTransactionPatch = {
  description: string;
  merchant: string | null;
  category: TransactionCategory;
  amount: number;
  date: string;
  tags: string[];
  is_subscription: boolean;
  is_transfer: boolean;
  account_id: string | null;
};

type Props = {
  transaction: Transaction | null;
  accounts?: Account[];
  /** Tag già usati nel progetto — autocompletamento nell’editor */
  tagSuggestions?: string[];
  onClose: () => void;
  onSave: (
    id: string,
    patch: EditTransactionPatch
  ) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
};

/**
 * Modal per modificare o eliminare una transazione. Stile ispirato Shadcn:
 * backdrop sfocato, card centrata, animazioni sobrie, chiusura con ESC o
 * click fuori. Il form è completamente controllato e ritorna un patch puro
 * al parent, che gestisce la persistenza (Supabase o locale).
 */
export default function EditTransactionModal({
  transaction,
  accounts = [],
  tagSuggestions = [],
  onClose,
  onSave,
  onDelete,
}: Props) {
  const open = Boolean(transaction);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [description, setDescription] = useState("");
  const [merchant, setMerchant] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState<TransactionCategory>("Altro");
  const [accountId, setAccountId] = useState<string | "">("");
  const [date, setDate] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSubscription, setIsSubscription] = useState(false);
  const [isTransfer, setIsTransfer] = useState(false);
  const [busy, setBusy] = useState<"saving" | "deleting" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --- Stato per il pannello "Salva come regola" ---------------------------
  // È un mini-form in-line dentro al modal: quando l'utente clicca
  // "Salva come regola" mostriamo i soli campi specifici della regola
  // (match_type, pattern, priority) e riusiamo gli altri valori (category,
  // tags, merchant, is_subscription, is_transfer) direttamente dal form.
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleMatchType, setRuleMatchType] = useState<
    "description_contains" | "merchant_contains" | "description_regex"
  >("description_contains");
  const [rulePattern, setRulePattern] = useState("");
  const [rulePriority, setRulePriority] = useState(50);
  const [ruleSaving, setRuleSaving] = useState(false);

  // Sync dei campi quando cambia la transazione selezionata.
  useEffect(() => {
    if (!transaction) return;
    setDescription(transaction.description);
    setMerchant(transaction.merchant ?? "");
    const abs = Math.abs(transaction.amount);
    setAmountStr(
      Number.isInteger(abs) ? String(abs) : abs.toString().replace(".", ",")
    );
    setType(transaction.amount >= 0 ? "income" : "expense");
    setCategory(transaction.category);
    setAccountId(transaction.account_id ?? "");
    setDate(toInputDate(transaction.date));
    setTags([...(transaction.tags ?? [])]);
    setIsSubscription(Boolean(transaction.is_subscription));
    setIsTransfer(Boolean(transaction.is_transfer));
    setBusy(null);
    setError(null);
    // Reset del mini-form "Salva come regola": si chiude di default ogni
    // volta che apri una nuova transazione.
    setRuleOpen(false);
    setRuleSaving(false);
    setRulePriority(50);
    // Precompilazione sensata del pattern: se c'è un merchant pulito, usiamo
    // quello col match_type "merchant_contains"; altrimenti usiamo una
    // parola "significativa" tratta dalla descrizione (la più lunga, per
    // evitare congiunzioni e codici).
    const mer = (transaction.merchant ?? "").trim();
    if (mer) {
      setRuleMatchType("merchant_contains");
      setRulePattern(mer.toLowerCase());
    } else {
      setRuleMatchType("description_contains");
      setRulePattern(pickKeyword(transaction.description));
    }
  }, [transaction]);

  // ESC chiude, blocca lo scroll del body quando aperto.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // Focus iniziale al dialog per screen reader / ESC.
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const isBusy = busy !== null;

  const parsedAmount = useMemo(() => {
    const n = Number.parseFloat(amountStr.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }, [amountStr]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!transaction) return;
    if (!description.trim()) {
      setError("La descrizione è obbligatoria.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Inserisci un importo valido.");
      return;
    }
    if (!date) {
      setError("Seleziona una data.");
      return;
    }

    const signed =
      type === "expense" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);
    const patch: EditTransactionPatch = {
      description: description.trim(),
      merchant: merchant.trim() || null,
      category,
      amount: signed,
      date: fromInputDate(date, transaction.date),
      tags: [...tags],
      is_subscription: isSubscription,
      is_transfer: isTransfer,
      account_id: accountId || null,
    };

    setBusy("saving");
    setError(null);
    try {
      await onSave(transaction.id, patch);
      onClose();
    } catch (err) {
      setBusy(null);
      setError(
        err instanceof Error ? err.message : "Impossibile salvare la modifica."
      );
    }
  }

  async function handleDelete() {
    if (!transaction) return;
    // La conferma e il rollback sono gestiti dal pattern "toast con Annulla"
    // del parent: qui chiudiamo subito il modal e lasciamo che il toast
    // informi l'utente e offra la possibilità di annullare l'azione.
    setBusy("deleting");
    setError(null);
    try {
      await onDelete(transaction.id);
      onClose();
    } catch (err) {
      setBusy(null);
      setError(
        err instanceof Error ? err.message : "Impossibile eliminare la transazione."
      );
    }
  }

  /**
   * Crea una regola di categorizzazione a partire dallo stato attuale del
   * modal. Riusa i valori già inseriti nel form (category, tags, merchant,
   * is_subscription, is_transfer) e chiede all'utente solo le 3 cose
   * specifiche della regola: come matchare (match_type), cosa matchare
   * (pattern) e con che priorità.
   */
  async function handleSaveRule() {
    if (!rulePattern.trim()) {
      toast.error("Manca il pattern della regola.");
      return;
    }
    setRuleSaving(true);
    try {
      const resp = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          match_type: ruleMatchType,
          pattern: rulePattern.trim(),
          category,
          tags: [...tags],
          merchant: merchant.trim() ? merchant.trim() : null,
          is_subscription: isSubscription,
          is_transfer: isTransfer,
          priority: Number.isFinite(rulePriority) ? rulePriority : 50,
          note: null,
        }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        throw new Error(json?.error ?? "Impossibile creare la regola.");
      }
      toast.success("Regola salvata", {
        description: `D'ora in poi "${rulePattern.trim()}" → ${category}${
          tags.length > 0 ? ` · ${tags.join(", ")}` : ""
        }.`,
        action: {
          label: "Gestisci regole",
          onClick: () => {
            window.location.href = "/regole";
          },
        },
      });
      setRuleOpen(false);
    } catch (err) {
      toast.error("Salvataggio regola fallito", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRuleSaving(false);
    }
  }

  if (!open || !transaction) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="edit-tx-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Chiudi"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      {/* Dialog: overflow solo sul corpo così i dropdown dei tag non vengono tagliati dal bordo della card */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-2xl outline-none"
      >
        <div className="shrink-0 p-4 sm:p-5 sm:pb-0 md:p-6 md:pb-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id="edit-tx-title"
                className="text-[18px] font-semibold tracking-tight"
              >
                Modifica transazione
              </h2>
              <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">
                Cambia i campi e salva. Le modifiche appariranno subito nella
                lista.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-5 sm:px-5 sm:pb-5 md:px-6 md:pb-6">
        <form onSubmit={handleSave} className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-12">
            <Label>Descrizione</Label>
            {/*
              Usiamo un textarea (non un input) perché le descrizioni
              aggregate da GoCardless — specialmente Mediolanum — possono
              essere molto lunghe: "Pagamenti paesi UE · DEL · Valuta EUR
              Paese Italia · C/O PAYPAL FARMASAVE - CARTA N. … - CIRCUITO
              MASTERCARD · Cod. MCC 5999 · Causale Movimento: …".
              In tabella mostriamo un titolo breve estratto, qui invece
              vogliamo vedere / correggere il testo completo.
            */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              disabled={isBusy}
              rows={3}
              className="min-h-[72px] w-full resize-y rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-[14px] leading-snug outline-none transition-colors placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)]"
            />
          </div>

          <div className="md:col-span-7">
            <Label>Esercente</Label>
            <Input
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              disabled={isBusy}
              placeholder="Opzionale"
            />
          </div>

          <div className="md:col-span-5">
            <Label>Data</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={isBusy}
              required
            />
          </div>

          <div className="md:col-span-6">
            <Label>Importo</Label>
            <Input
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              inputMode="decimal"
              disabled={isBusy}
              required
              placeholder="0,00"
            />
          </div>

          <div className="md:col-span-6">
            <Label>Tipo</Label>
            <div className="flex h-10 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] p-1 text-[12px] font-medium">
              <ToggleChip
                active={type === "expense"}
                onClick={() => setType("expense")}
                disabled={isBusy}
              >
                Uscita
              </ToggleChip>
              <ToggleChip
                active={type === "income"}
                onClick={() => setType("income")}
                disabled={isBusy}
              >
                Entrata
              </ToggleChip>
            </div>
          </div>

          {/*
            Riga dedicata ai flag "Ricorrente" e "Giroconto".
            Usiamo un col-span-12 con flex interno: in questo modo, anche se
            il grid-auto-flow del form riordinasse gli item, i due chip
            restano SEMPRE sulla propria riga e si spartiscono equamente lo
            spazio disponibile (con `flex-1 min-w-0`) senza possibilità di
            sforare — cosa che capitava a 520-540px perché l'auto-flow del
            grid 12-col li affiancava a Importo/Tipo.
          */}
          <div className="md:col-span-12">
            <div className="flex w-full items-stretch gap-2 sm:gap-3">
              <label
                className={[
                  "flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[12.5px] font-medium transition-colors",
                  isSubscription
                    ? "border-[color:var(--color-accent)] text-[color:var(--color-accent)]"
                    : "text-[color:var(--color-muted-foreground)]",
                  isBusy ? "opacity-50 pointer-events-none" : "",
                ].join(" ")}
                title="Abbonamento ricorrente"
              >
                <input
                  type="checkbox"
                  checked={isSubscription}
                  onChange={(e) => setIsSubscription(e.target.checked)}
                  className="sr-only"
                />
                <Repeat className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Ricorrente</span>
              </label>

              <label
                className={[
                  "flex h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[12.5px] font-medium transition-colors",
                  isTransfer
                    ? "border-[color:var(--color-accent)] text-[color:var(--color-accent)]"
                    : "text-[color:var(--color-muted-foreground)]",
                  isBusy ? "opacity-50 pointer-events-none" : "",
                ].join(" ")}
                title="Giroconto / trasferimento fra tuoi conti (escluso da entrate/uscite)"
              >
                <input
                  type="checkbox"
                  checked={isTransfer}
                  onChange={(e) => setIsTransfer(e.target.checked)}
                  className="sr-only"
                />
                <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Giroconto</span>
              </label>
            </div>
          </div>

          <div className="md:col-span-6">
            <Label>Categoria</Label>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as TransactionCategory)
              }
              disabled={isBusy}
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors focus:border-[color:var(--color-accent)]"
            >
              {TRANSACTION_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-6">
            <Label>Conto</Label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={isBusy || accounts.length === 0}
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors focus:border-[color:var(--color-accent)] disabled:opacity-60"
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

          <div className="md:col-span-12">
            <Label>Tag</Label>
            <TagsInput
              value={tags}
              onChange={setTags}
              suggestions={tagSuggestions}
              disabled={isBusy}
              placeholder="Es. casa, fisso…"
              dropdownPlacement="above"
            />
          </div>

          <div className="md:col-span-12">
            {ruleOpen ? (
              <div className="rounded-xl border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/5 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-[color:var(--color-accent)]" />
                    <div>
                      <p className="text-[13px] font-semibold">
                        Crea una regola di categorizzazione
                      </p>
                      <p className="text-[11.5px] text-[color:var(--color-muted-foreground)]">
                        Verrà applicata alle prossime transazioni che
                        corrispondono, prima di Gemini.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRuleOpen(false)}
                    className="text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
                    aria-label="Chiudi"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
                  <div className="md:col-span-4">
                    <Label>Quando</Label>
                    <select
                      value={ruleMatchType}
                      onChange={(e) =>
                        setRuleMatchType(
                          e.target.value as typeof ruleMatchType
                        )
                      }
                      disabled={ruleSaving}
                      className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[13px] outline-none focus:border-[color:var(--color-accent)]"
                    >
                      <option value="description_contains">
                        Descrizione contiene
                      </option>
                      <option value="merchant_contains">
                        Merchant contiene
                      </option>
                      <option value="description_regex">
                        Descrizione (regex)
                      </option>
                    </select>
                  </div>
                  <div className="md:col-span-6">
                    <Label>Pattern</Label>
                    <Input
                      value={rulePattern}
                      onChange={(e) => setRulePattern(e.target.value)}
                      disabled={ruleSaving}
                      placeholder="es. eni, netflix, ^bonifico.*"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Priorità</Label>
                    <Input
                      type="number"
                      value={rulePriority}
                      onChange={(e) =>
                        setRulePriority(Number(e.target.value) || 0)
                      }
                      disabled={ruleSaving}
                    />
                  </div>
                </div>

                <p className="mt-2 text-[11.5px] text-[color:var(--color-muted-foreground)]">
                  La regola userà la categoria corrente{" "}
                  <strong>{category}</strong>
                  {tags.length > 0 ? (
                    <>
                      {" "}
                      con tag <strong>{tags.join(", ")}</strong>
                    </>
                  ) : null}
                  {isSubscription ? ", marcata ricorrente" : ""}
                  {isTransfer ? ", marcata giroconto" : ""}.
                </p>

                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRuleOpen(false)}
                    disabled={ruleSaving}
                    className="inline-flex h-9 items-center rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[12.5px] font-medium hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRule}
                    disabled={ruleSaving || !rulePattern.trim()}
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-[color:var(--color-accent)] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
                  >
                    {ruleSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Crea regola
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {error ? (
            <div className="md:col-span-12 flex items-center gap-2 rounded-xl border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/10 px-3 py-2 text-[13px] text-[color:var(--color-expense)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="md:col-span-12 mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--color-border)] pt-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={isBusy}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[color:var(--color-expense)]/40 px-3.5 text-[13px] font-semibold text-[color:var(--color-expense)] transition-colors hover:bg-[color:var(--color-expense)]/10 disabled:opacity-50"
              >
                {busy === "deleting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Elimina
              </button>
              <button
                type="button"
                onClick={() => setRuleOpen((v) => !v)}
                disabled={isBusy}
                title="Crea una regola IA a partire da questa transazione"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-[color:var(--color-accent)]/40 px-3.5 text-[13px] font-semibold text-[color:var(--color-accent)] transition-colors hover:bg-[color:var(--color-accent)]/10 disabled:opacity-50"
              >
                <Wand2 className="h-4 w-4" />
                Salva come regola
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isBusy}
                className="inline-flex h-10 items-center rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-[13px] font-medium transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={isBusy}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--color-foreground)] px-4 text-[13px] font-semibold text-[color:var(--color-background)] transition-opacity disabled:opacity-50"
              >
                {busy === "saving" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Salvataggio…
                  </>
                ) : (
                  "Salva modifiche"
                )}
              </button>
            </div>
          </div>
        </form>
        </div>
      </div>
    </div>
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
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex-1 rounded-lg px-2 py-1.5 transition-colors disabled:opacity-50",
        active
          ? "bg-[color:var(--color-surface)] text-[color:var(--color-foreground)] shadow-sm"
          : "text-[color:var(--color-muted-foreground)]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Seleziona la parola "più significativa" di una descrizione, così il
 * pattern iniziale della regola è già un buon candidato e non la frase
 * intera (che raramente farebbe match con altre transazioni).
 *
 * Euristica: tokenizziamo su separatori comuni, scartiamo token troppo
 * corti (≤ 2 char), sigle numeriche pure (date, importi) e stopword
 * italiane/inglesi ricorrenti nelle descrizioni bancarie. Poi prendiamo
 * la parola più lunga. Se non resta nulla, fallback alla prima parola
 * non vuota, o alla descrizione stessa se proprio unica.
 */
function pickKeyword(description: string): string {
  const raw = (description || "").toLowerCase();
  const stop = new Set([
    "bonifico",
    "pagamento",
    "addebito",
    "acquisto",
    "pos",
    "sepa",
    "ops",
    "del",
    "per",
    "con",
    "and",
    "the",
    "via",
    "srl",
    "spa",
    "ltd",
  ]);
  const tokens = raw
    .split(/[\s,;:/.()\-–—]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !/^\d+([.,]\d+)?$/.test(t) && !stop.has(t));
  if (tokens.length === 0) {
    const first = raw.split(/\s+/).find(Boolean);
    return first ?? raw;
  }
  tokens.sort((a, b) => b.length - a.length);
  return tokens[0];
}

/**
 * Converte una data ISO (timestamptz o "YYYY-MM-DD") nel formato accettato
 * dagli input `type="date"` di HTML: sempre "YYYY-MM-DD" locale.
 */
function toInputDate(iso: string): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  // Se è già "YYYY-MM-DD" la ritorniamo invariata.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Inverso di `toInputDate`: se la data originale era un timestamptz con orario,
 * preserviamo l'orario originale per non perdere informazione; altrimenti
 * torniamo la data pura.
 */
function fromInputDate(inputDate: string, original: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(original)) return inputDate;
  const d = new Date(original);
  if (Number.isNaN(d.getTime())) return inputDate;
  const [y, m, day] = inputDate.split("-").map(Number);
  d.setFullYear(y);
  d.setMonth((m ?? 1) - 1);
  d.setDate(day ?? 1);
  return d.toISOString();
}
