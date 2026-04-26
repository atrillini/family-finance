"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import {
  CASH_WALLET_NAME,
  dispatchRefetchAccounts,
  parseCashExpenseLine,
} from "@/lib/cash-wallet";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import type { TransactionAnalysis } from "@/lib/gemini";
import { normalizeTagLabel } from "@/lib/tag-colors";

type Phase = "idle" | "ensuring" | "ai" | "saving";

export default function QuickCashExpense() {
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState("");
  const [txDate, setTxDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [authed, setAuthed] = useState(false);

  const configured = isSupabaseConfigured();

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseClient();
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setAuthed(Boolean(data.user));
    })();
    const supabase = getSupabaseClient();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(Boolean(session?.user));
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [configured]);

  const resetForm = useCallback(() => {
    setLine("");
    setTxDate(new Date().toISOString().slice(0, 10));
    setPhase("idle");
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    resetForm();
  }, [resetForm]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const raw = line.trim();
      if (!raw) {
        toast.error("Scrivi una riga con importo e cosa hai speso.");
        return;
      }

      const parsed = parseCashExpenseLine(raw);
      if (!parsed) {
        toast.error(
          "Non trovo un importo. Prova ad esempio: «20 pizza» o «15,50 € caffè»."
        );
        return;
      }
      const { amount, description: cleanDescription } = parsed;

      setPhase("ensuring");
      try {
        const ensureRes = await fetch("/api/accounts/cash-wallet", {
          method: "POST",
        });
        const ensureJson = (await ensureRes.json()) as {
          account?: { id: string };
          error?: string;
        };
        if (!ensureRes.ok || !ensureJson.account?.id) {
          throw new Error(ensureJson.error ?? "Impossibile creare il conto Contanti.");
        }
        const accountId = ensureJson.account.id;
        dispatchRefetchAccounts();

        setPhase("ai");
        const catRes = await fetch("/api/categorize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: cleanDescription }),
        });
        const catData = (await catRes.json()) as Partial<TransactionAnalysis> & {
          error?: string;
        };
        if (!catRes.ok || !catData.category) {
          throw new Error(catData.error ?? "Impossibile analizzare la spesa.");
        }

        const analysis: TransactionAnalysis = {
          category: catData.category,
          merchant: catData.merchant ?? "",
          tags: catData.tags ?? [],
          is_subscription: Boolean(catData.is_subscription),
          is_transfer: Boolean(catData.is_transfer),
        };

        setPhase("saving");
        const supabase = getSupabaseClient();
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr || !user) {
          throw new Error("Devi essere autenticato.");
        }

        const tags = (analysis.tags ?? []).map(normalizeTagLabel).filter(Boolean);
        const signed = -Math.abs(amount);
        const dateIso = txDate
          ? `${txDate}T12:00:00.000Z`
          : new Date().toISOString();

        const { error: insErr } = await supabase.from("transactions").insert({
          description: cleanDescription,
          merchant: analysis.merchant?.trim() || null,
          category: analysis.category,
          amount: signed,
          tags,
          is_subscription: analysis.is_subscription,
          is_transfer: analysis.is_transfer,
          is_hidden: false,
          account_id: accountId,
          user_id: user.id,
          date: dateIso,
        });

        if (insErr) throw insErr;

        toast.success("Spesa in contanti registrata.", {
          description: `${CASH_WALLET_NAME} · ${analysis.category}`,
        });
        handleClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore salvataggio.");
        setPhase("idle");
      }
    },
    [line, txDate, handleClose]
  );

  if (!configured || !authed) return null;

  const busy = phase !== "idle";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[color:var(--color-foreground)] text-[color:var(--color-background)] shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.98] md:bottom-8 md:right-8"
        aria-label="Spesa contanti veloce"
        title="Spesa contanti veloce"
      >
        <Banknote className="h-6 w-6" strokeWidth={2} />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-cash-title"
        >
          <div className="card-surface w-full max-w-md rounded-2xl p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="quick-cash-title"
                  className="text-[16px] font-semibold tracking-tight"
                >
                  Spesa in contanti
                </h2>
                <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">
                  Una riga con importo e descrizione; viene usato il conto{" "}
                  <span className="font-medium">{CASH_WALLET_NAME}</span> e
                  Gemini per categoria ed esercente.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={busy}
                className="rounded-lg p-2 text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
                aria-label="Chiudi"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={onSubmit} className="mt-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
                  Cosa hai pagato
                </label>
                <textarea
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  rows={3}
                  disabled={busy}
                  placeholder="Es. 18,50 pranzo lavoro, 20 pizza con amici"
                  className="w-full resize-none rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2.5 text-[14px] outline-none placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
                  Data movimento
                </label>
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  disabled={busy}
                  className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none focus:border-[color:var(--color-accent)]"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={busy}
                  className="h-10 flex-1 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[13px] font-medium transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-[color:var(--color-foreground)] text-[13px] font-semibold text-[color:var(--color-background)] disabled:opacity-50"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {phase === "ensuring"
                        ? "Conto…"
                        : phase === "ai"
                          ? "Gemini…"
                          : "Salvo…"}
                    </>
                  ) : (
                    "Salva"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
