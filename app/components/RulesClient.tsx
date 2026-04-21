"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  Loader2,
  Pencil,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { CategorizationRuleRow } from "@/lib/supabase";
import { TRANSACTION_CATEGORIES } from "@/lib/gemini";

type MatchType = CategorizationRuleRow["match_type"];

type FormState = {
  match_type: MatchType;
  pattern: string;
  category: (typeof TRANSACTION_CATEGORIES)[number];
  tags: string;
  merchant: string;
  is_subscription: boolean;
  is_transfer: boolean;
  priority: number;
  note: string;
};

const EMPTY_FORM: FormState = {
  match_type: "description_contains",
  pattern: "",
  category: "Altro",
  tags: "",
  merchant: "",
  is_subscription: false,
  is_transfer: false,
  priority: 0,
  note: "",
};

const MATCH_LABELS: Record<MatchType, string> = {
  description_contains: "Descrizione contiene",
  merchant_contains: "Merchant contiene",
  description_regex: "Descrizione matcha regex",
};

export default function RulesClient() {
  const [rules, setRules] = useState<CategorizationRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<CategorizationRuleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await fetch("/api/rules", { cache: "no-store" });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? "Errore nel caricamento");
      setRules((json.rules ?? []) as CategorizationRuleRow[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setCreating(true);
  }

  function openEdit(rule: CategorizationRuleRow) {
    setCreating(false);
    setEditing(rule);
    setForm({
      match_type: rule.match_type,
      pattern: rule.pattern,
      category: rule.category,
      tags: (rule.tags ?? []).join(", "),
      merchant: rule.merchant ?? "",
      is_subscription: Boolean(rule.is_subscription),
      is_transfer: Boolean(rule.is_transfer),
      priority: Number(rule.priority ?? 0),
      note: rule.note ?? "",
    });
    setFormError(null);
  }

  function closeForm() {
    setEditing(null);
    setCreating(false);
    setFormError(null);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.pattern.trim()) {
      setFormError("Il pattern è obbligatorio");
      return;
    }
    const payload = {
      match_type: form.match_type,
      pattern: form.pattern.trim(),
      category: form.category,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      merchant: form.merchant.trim() || null,
      is_subscription: form.is_subscription,
      is_transfer: form.is_transfer,
      priority: Number(form.priority) || 0,
      note: form.note.trim() || null,
    };
    setSaving(true);
    try {
      const url = editing ? `/api/rules/${editing.id}` : "/api/rules";
      const method = editing ? "PATCH" : "POST";
      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error ?? "Salvataggio fallito");
      toast.success(
        editing ? "Regola aggiornata" : "Nuova regola creata",
        {
          description: `"${payload.pattern}" → ${payload.category}`,
        }
      );
      closeForm();
      await refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rule: CategorizationRuleRow) {
    if (!confirm(`Eliminare la regola "${rule.pattern}"?`)) return;
    try {
      const resp = await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error ?? "Eliminazione fallita");
      toast.success("Regola eliminata");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const sorted = useMemo(
    () =>
      [...rules].sort((a, b) => {
        if (a.priority !== b.priority) return b.priority - a.priority;
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }),
    [rules]
  );

  const isFormOpen = creating || editing !== null;

  return (
    <div className="space-y-5">
      <div className="card-surface p-5 flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0a84ff] to-[#5e5ce6] text-white">
          <Wand2 className="h-[18px] w-[18px]" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-[15px] font-semibold">
            Come funzionano le regole
          </p>
          <p className="text-[13px] leading-relaxed text-[color:var(--color-muted-foreground)]">
            Ogni regola definisce uno schema ricorrente: &quot;se la descrizione
            contiene <code className="font-mono">eni</code>, categorizza come{" "}
            <strong>Trasporti</strong> con tag <strong>carburante</strong>
            &quot;. Le regole sono applicate prima di Gemini sia durante il
            sync che quando clicchi il pulsante Gemini accanto a una
            transazione. Le regole attive vengono anche passate come memoria
            a Gemini, così l&apos;IA impara il tuo stile anche per
            transazioni non coperte da match esatto.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--color-foreground)] px-4 text-[13px] font-semibold text-[color:var(--color-background)] transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          Nuova regola
        </button>
      </div>

      {loadError ? (
        <div className="card-surface flex items-center gap-2 border-[color:var(--color-expense)]/40 bg-[color:var(--color-expense)]/10 p-4 text-[13px] text-[color:var(--color-expense)]">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      ) : null}

      <div className="card-surface overflow-hidden">
        <div className="border-b border-[color:var(--color-border)] px-5 py-3 text-[12px] font-semibold uppercase tracking-wider text-[color:var(--color-muted-foreground)] flex items-center justify-between">
          <span>Le tue regole ({sorted.length})</span>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
        </div>

        {sorted.length === 0 && !loading ? (
          <div className="px-5 py-10 text-center text-[13px] text-[color:var(--color-muted-foreground)]">
            Nessuna regola configurata. Clicca su &quot;Nuova regola&quot;
            per iniziare a insegnare all&apos;IA i tuoi schemi.
          </div>
        ) : null}

        <ul className="divide-y divide-[color:var(--color-border)]">
          {sorted.map((rule) => (
            <li
              key={rule.id}
              className="flex items-start gap-4 px-5 py-4 hover:bg-[color:var(--color-surface-muted)]/50"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--color-muted-foreground)]">
                    {MATCH_LABELS[rule.match_type]}
                  </span>
                  <code className="rounded-md bg-[color:var(--color-surface-muted)] px-1.5 py-0.5 font-mono text-[12.5px]">
                    {rule.pattern}
                  </code>
                  <span className="text-[12px] text-[color:var(--color-muted-foreground)]">
                    →
                  </span>
                  <span className="rounded-full bg-gradient-to-r from-[#0a84ff]/15 to-[#5e5ce6]/15 px-2 py-0.5 text-[12px] font-semibold text-[color:var(--color-accent)]">
                    {rule.category}
                  </span>
                  {rule.is_subscription ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                      <Repeat className="h-3 w-3" /> abbonamento
                    </span>
                  ) : null}
                  {rule.is_transfer ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--color-border)] px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                      <ArrowRightLeft className="h-3 w-3" /> giroconto
                    </span>
                  ) : null}
                  {rule.priority > 0 ? (
                    <span className="rounded-full bg-[color:var(--color-surface-muted)] px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]">
                      priorità {rule.priority}
                    </span>
                  ) : null}
                </div>
                {rule.tags?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {rule.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-[color:var(--color-surface-muted)] px-2 py-0.5 text-[11px] text-[color:var(--color-muted-foreground)]"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                ) : null}
                {rule.merchant ? (
                  <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
                    Merchant forzato: <strong>{rule.merchant}</strong>
                  </p>
                ) : null}
                {rule.note ? (
                  <p className="text-[12px] italic text-[color:var(--color-muted-foreground)]">
                    {rule.note}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(rule)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
                  aria-label="Modifica"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(rule)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-expense)]/15 hover:text-[color:var(--color-expense)]"
                  aria-label="Elimina"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {isFormOpen ? (
        <RuleFormModal
          editingId={editing?.id ?? null}
          form={form}
          setForm={setForm}
          error={formError}
          busy={saving}
          onSubmit={handleSave}
          onClose={closeForm}
        />
      ) : null}
    </div>
  );
}

function RuleFormModal({
  editingId,
  form,
  setForm,
  error,
  busy,
  onSubmit,
  onClose,
}: {
  editingId: string | null;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  error: string | null;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Chiudi"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-[560px] rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[color:var(--color-accent)]" />
              <h2 className="text-[18px] font-semibold tracking-tight">
                {editingId ? "Modifica regola" : "Nuova regola"}
              </h2>
            </div>
            <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">
              Se il pattern matcha una transazione, verranno applicati i
              valori qui sotto e Gemini non verrà chiamato.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo di match</Label>
              <select
                value={form.match_type}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    match_type: e.target.value as MatchType,
                  }))
                }
                className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[13.5px] outline-none focus:border-[color:var(--color-accent)]"
              >
                <option value="description_contains">
                  Descrizione contiene
                </option>
                <option value="merchant_contains">Merchant contiene</option>
                <option value="description_regex">
                  Regex sulla descrizione
                </option>
              </select>
            </div>
            <div>
              <Label>Priorità</Label>
              <input
                type="number"
                min={0}
                max={1000}
                value={form.priority}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    priority: Number(e.target.value) || 0,
                  }))
                }
                className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[13.5px] outline-none focus:border-[color:var(--color-accent)]"
              />
            </div>
          </div>

          <div>
            <Label>Pattern</Label>
            <input
              value={form.pattern}
              onChange={(e) =>
                setForm((f) => ({ ...f, pattern: e.target.value }))
              }
              placeholder="es. eni, youtube, bonifico*ikea"
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[13.5px] outline-none focus:border-[color:var(--color-accent)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Categoria</Label>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    category: e.target
                      .value as (typeof TRANSACTION_CATEGORIES)[number],
                  }))
                }
                className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[13.5px] outline-none focus:border-[color:var(--color-accent)]"
              >
                {TRANSACTION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Merchant da forzare (opz.)</Label>
              <input
                value={form.merchant}
                onChange={(e) =>
                  setForm((f) => ({ ...f, merchant: e.target.value }))
                }
                placeholder="es. Google YouTube"
                className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[13.5px] outline-none focus:border-[color:var(--color-accent)]"
              />
            </div>
          </div>

          <div>
            <Label>Tag (separati da virgole)</Label>
            <input
              value={form.tags}
              onChange={(e) =>
                setForm((f) => ({ ...f, tags: e.target.value }))
              }
              placeholder="carburante, trasporti"
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[13.5px] outline-none focus:border-[color:var(--color-accent)]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex items-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 px-3 py-2 text-[13px]">
              <input
                type="checkbox"
                checked={form.is_subscription}
                onChange={(e) =>
                  setForm((f) => ({ ...f, is_subscription: e.target.checked }))
                }
              />
              <Repeat className="h-3.5 w-3.5" /> Abbonamento
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 px-3 py-2 text-[13px]">
              <input
                type="checkbox"
                checked={form.is_transfer}
                onChange={(e) =>
                  setForm((f) => ({ ...f, is_transfer: e.target.checked }))
                }
              />
              <ArrowRightLeft className="h-3.5 w-3.5" /> Giroconto
            </label>
          </div>

          <div>
            <Label>Nota (opzionale)</Label>
            <input
              value={form.note}
              onChange={(e) =>
                setForm((f) => ({ ...f, note: e.target.value }))
              }
              placeholder="es. entrate YouTube mensili"
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[13.5px] outline-none focus:border-[color:var(--color-accent)]"
            />
          </div>

          {error ? (
            <div className="flex items-center gap-2 rounded-xl border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/10 px-3 py-2 text-[13px] text-[color:var(--color-expense)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-[color:var(--color-border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex h-10 items-center rounded-xl border border-[color:var(--color-border)] px-4 text-[13px] font-medium transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[color:var(--color-foreground)] px-4 text-[13px] font-semibold text-[color:var(--color-background)] transition-opacity disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Salvataggio…
                </>
              ) : editingId ? (
                "Aggiorna"
              ) : (
                "Crea regola"
              )}
            </button>
          </div>
        </form>
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
