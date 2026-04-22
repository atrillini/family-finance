"use client";

import { useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { normalizeTagLabel } from "@/lib/tag-colors";
import TagChip from "./TagChip";

type TagsInputProps = {
  id?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
  disabled?: boolean;
  placeholder?: string;
  /** Mostra la riga di aiuto sotto il campo */
  showHint?: boolean;
};

/**
 * Chip + campo di testo con suggerimenti (prefisso sul token dopo l’ultima virgola).
 */
export default function TagsInput({
  id: externalId,
  value,
  onChange,
  suggestions,
  disabled,
  placeholder = "Aggiungi tag…",
  showHint = true,
}: TagsInputProps) {
  const genId = useId();
  const listId = `${genId}-suggestions`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  const activeFragment = useMemo(() => {
    const parts = draft.split(",");
    const last = parts[parts.length - 1] ?? "";
    return last.trim();
  }, [draft]);

  const suggestionPool = useMemo(() => {
    const set = new Set<string>();
    for (const s of suggestions) {
      const n = normalizeTagLabel(s);
      if (n) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [suggestions]);

  const filteredSuggestions = useMemo(() => {
    const have = new Set(value.map((t) => normalizeTagLabel(t)));
    const frag = activeFragment.toLowerCase();
    return suggestionPool
      .filter((s) => {
        if (have.has(s)) return false;
        if (!frag) return true;
        return s.startsWith(frag);
      })
      .slice(0, 12);
  }, [suggestionPool, value, activeFragment]);

  const open =
    !disabled &&
    activeFragment.length > 0 &&
    filteredSuggestions.length > 0;

  function mergeNewTags(raw: string) {
    const parts = raw
      .split(",")
      .map((t) => normalizeTagLabel(t))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...new Set([...value, ...parts])];
    onChange(next);
  }

  return (
    <div className="relative">
      <div
        className={[
          "flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 py-1.5 transition-colors",
          disabled ? "opacity-60" : "focus-within:border-[color:var(--color-accent)]",
        ].join(" ")}
      >
        {value.map((t, i) => (
          <span key={`${t}-${i}`} className="inline-flex items-center gap-0.5">
            <TagChip tag={t} size="sm" />
            {!disabled ? (
              <button
                type="button"
                aria-label={`Rimuovi tag ${t}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="rounded-full p-0.5 text-[color:var(--color-muted-foreground)] hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </span>
        ))}
        <input
          ref={inputRef}
          id={externalId}
          disabled={disabled}
          value={draft}
          autoComplete="off"
          autoCorrect="off"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          placeholder={value.length === 0 ? placeholder : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(",")) {
              const head = v.slice(0, -1);
              mergeNewTags(head);
              setDraft("");
              return;
            }
            setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (draft.trim()) {
                mergeNewTags(draft);
                setDraft("");
              }
              return;
            }
            if (e.key === "Backspace" && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim()) {
              mergeNewTags(draft);
              setDraft("");
            }
          }}
          className="min-w-[120px] flex-1 bg-transparent py-1 text-[14px] outline-none placeholder:text-[color:var(--color-muted-foreground)]"
        />
      </div>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-48 overflow-auto rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] py-1 shadow-xl"
        >
          {filteredSuggestions.map((s) => (
            <li key={s} role="option">
              <button
                type="button"
                className="flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-[color:var(--color-surface-muted)]"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const norm = normalizeTagLabel(s);
                  if (!norm) return;
                  const next = [...new Set([...value, norm])];
                  onChange(next);
                  const commaIdx = draft.lastIndexOf(",");
                  const keep =
                    commaIdx >= 0 ? `${draft.slice(0, commaIdx + 1)} ` : "";
                  setDraft(keep);
                  inputRef.current?.focus();
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {showHint ? (
        <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
          Suggerimenti dai tag già presenti · virgola o Invio per confermare
        </p>
      ) : null}
    </div>
  );
}
