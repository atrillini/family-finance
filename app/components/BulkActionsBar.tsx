"use client";

import { useState } from "react";
import {
  ArrowRightLeft,
  ChevronDown,
  Loader2,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import TagsInput from "./TagsInput";
import type { Account } from "@/lib/mock-data";
import {
  TRANSACTION_CATEGORIES,
  type TransactionCategory,
} from "@/lib/gemini";

type Props = {
  /** Quante transazioni sono selezionate. Se 0, la bar non viene renderizzata. */
  count: number;
  /** Conti disponibili (per l'azione "Sposta su conto"). */
  accounts?: Account[];
  /** Ricategorizza con IA tutte le transazioni selezionate. */
  onRecategorize: () => Promise<void> | void;
  /** Marca/smarca giroconto in massa. Se non passata, il pulsante non compare. */
  onToggleTransfer?: (isTransfer: boolean) => Promise<void> | void;
  /** Applica una categoria manuale. */
  onSetCategory?: (category: TransactionCategory) => Promise<void> | void;
  /** Sposta le transazioni su un conto specifico (o null per "nessuno"). */
  onSetAccount?: (accountId: string | null) => Promise<void> | void;
  /** Elimina con undo. */
  onDelete: () => Promise<void> | void;
  /** Unisce questi tag a tutte le transazioni selezionate (senza rimuovere gli esistenti). */
  onAddTags?: (tags: string[]) => Promise<void> | void;
  /** Tag già presenti nei dati — suggerimenti nell’azione massiva */
  tagSuggestions?: string[];
  /** Deseleziona tutto. */
  onClear: () => void;
  /** ID di un'azione in corso (per mostrare lo spinner). */
  busy?: string | null;
};

/**
 * Barra fissa in alto quando ci sono transazioni selezionate, così non copre
 * le righe vicino al bordo inferiore del viewport. Il parent gestisce la logica
 * di business: qui si limita a mostrare la UI e notificare i click.
 */
export default function BulkActionsBar({
  count,
  accounts = [],
  onRecategorize,
  onToggleTransfer,
  onSetCategory,
  onSetAccount,
  onDelete,
  onAddTags,
  tagSuggestions = [],
  onClear,
  busy,
}: Props) {
  const [tagsPanelOpen, setTagsPanelOpen] = useState(false);
  const [pendingTags, setPendingTags] = useState<string[]>([]);

  if (count === 0) return null;

  return (
    <div className="fixed top-6 left-1/2 z-40 w-[min(960px,calc(100vw-32px))] -translate-x-1/2">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)]/95 px-3 py-2 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2 pl-1 pr-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--color-accent)]/15 text-[11px] font-semibold text-[color:var(--color-accent)]">
            {count}
          </span>
          <span className="text-[13px] font-medium">selezionate</span>
        </div>

        <div className="hidden h-5 w-px bg-[color:var(--color-border)] md:block" />

        <ActionButton
          onClick={onRecategorize}
          icon={<Sparkles className="h-3.5 w-3.5" />}
          loading={busy === "recategorize"}
        >
          Categorizza con IA
        </ActionButton>

        {onToggleTransfer ? (
          <div className="flex items-center gap-1">
            <ActionButton
              onClick={() => onToggleTransfer(true)}
              icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
              loading={busy === "transfer-on"}
            >
              Marca giroconto
            </ActionButton>
            <ActionButton
              onClick={() => onToggleTransfer(false)}
              icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
              loading={busy === "transfer-off"}
              subtle
            >
              Annulla giroconto
            </ActionButton>
          </div>
        ) : null}

        {onSetCategory ? (
          <DropdownButton
            label="Cambia categoria"
            busy={busy === "category"}
            items={TRANSACTION_CATEGORIES.map((c) => ({
              key: c,
              label: c,
              onClick: () => onSetCategory(c),
            }))}
          />
        ) : null}

        {onAddTags ? (
          <div
            className="relative"
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (next && e.currentTarget.contains(next)) return;
              setTagsPanelOpen(false);
            }}
          >
            <button
              type="button"
              onClick={() => setTagsPanelOpen((v) => !v)}
              disabled={busy === "tags"}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-[12.5px] font-medium transition-colors hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)] disabled:opacity-60"
            >
              {busy === "tags" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Tag className="h-3.5 w-3.5" />
              )}
              Aggiungi tag
              <ChevronDown className="h-3 w-3" />
            </button>
            {tagsPanelOpen ? (
              <div
                className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(340px,calc(100vw-48px))] rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-3 shadow-2xl"
                onMouseDown={(e) => {
                  const el = e.target as HTMLElement | null;
                  if (!el) return;
                  // Non bloccare il focus su input/pulsanti: preventDefault sul contenitore
                  // impediva di digitare nel TagsInput (mousedown in bubble).
                  if (
                    el.closest(
                      "input, textarea, select, button, [role='option'], [contenteditable='true']"
                    )
                  ) {
                    return;
                  }
                  e.preventDefault();
                }}
              >
                <p className="mb-2 text-[11.5px] text-[color:var(--color-muted-foreground)]">
                  I tag vengono aggiunti a tutte le righe selezionate (unione con
                  quelli già presenti).
                </p>
                <TagsInput
                  value={pendingTags}
                  onChange={setPendingTags}
                  suggestions={tagSuggestions}
                  disabled={busy === "tags"}
                  placeholder="cerca o crea tag…"
                  showHint={false}
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-[color:var(--color-border)] px-3 py-1.5 text-[12px] font-medium hover:bg-[color:var(--color-surface-muted)]"
                    onClick={() => {
                      setPendingTags([]);
                      setTagsPanelOpen(false);
                    }}
                  >
                    Chiudi
                  </button>
                  <button
                    type="button"
                    disabled={busy === "tags" || pendingTags.length === 0}
                    className="rounded-lg bg-[color:var(--color-accent)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                    onClick={() => {
                      void onAddTags(pendingTags);
                      setPendingTags([]);
                      setTagsPanelOpen(false);
                    }}
                  >
                    Applica
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {onSetAccount && accounts.length > 0 ? (
          <DropdownButton
            label="Sposta su conto"
            busy={busy === "account"}
            items={[
              {
                key: "__none__",
                label: "— Nessun conto —",
                onClick: () => onSetAccount(null),
              },
              ...accounts.map((a) => ({
                key: a.id,
                label: a.name,
                onClick: () => onSetAccount(a.id),
              })),
            ]}
          />
        ) : null}

        <ActionButton
          onClick={onDelete}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          loading={busy === "delete"}
          danger
        >
          Elimina
        </ActionButton>

        <div className="ml-auto flex items-center">
          <button
            type="button"
            onClick={onClear}
            aria-label="Deseleziona tutte"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  loading,
  danger,
  subtle,
  children,
}: {
  onClick: () => void | Promise<void>;
  icon: React.ReactNode;
  loading?: boolean;
  danger?: boolean;
  subtle?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={loading}
      className={[
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors disabled:opacity-60",
        danger
          ? "border-[color:var(--color-expense)]/40 text-[color:var(--color-expense)] hover:bg-[color:var(--color-expense)]/10"
          : subtle
          ? "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)]"
          : "border-[color:var(--color-border)] hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)]",
      ].join(" ")}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

function DropdownButton({
  label,
  busy,
  items,
}: {
  label: string;
  busy?: boolean;
  items: { key: string; label: string; onClick: () => void | Promise<void> }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[color:var(--color-border)] px-3 text-[12.5px] font-medium transition-colors hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)]/10 hover:text-[color:var(--color-accent)] disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {label}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-10 max-h-60 w-56 overflow-auto rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] py-1 shadow-xl">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                item.onClick();
                setOpen(false);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-[color:var(--color-surface-muted)]"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
