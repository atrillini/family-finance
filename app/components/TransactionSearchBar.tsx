"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useHeaderSearch } from "@/lib/search-context";
import { TRANSACTION_CATEGORIES } from "@/lib/gemini";
import { normalizeTagLabel } from "@/lib/tag-colors";

type Props = {
  className?: string;
  /** Se true, il campo occupa tutta la larghezza del contenitore (es. sotto al titolo su mobile) */
  fullWidth?: boolean;
  /**
   * Tag già usati nel dataset (stessi usati in modal / bulk) per
   * autocompletamento coerente con `TagsInput`.
   */
  tagSuggestions?: string[];
};

/**
 * Campo di ricerca testuale sulle transazioni (stato globale via `useHeaderSearch`).
 * Stessa logica e suggerimenti categoria che erano in `PageHeader`, spostata
 * accanto / sopra la tabella per comodità.
 */
export default function TransactionSearchBar({
  className = "",
  fullWidth = false,
  tagSuggestions = [],
}: Props) {
  const { query, setQuery } = useHeaderSearch();
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!focused) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [focused]);

  const suggestionPoolTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of tagSuggestions) {
      const n = normalizeTagLabel(s);
      if (n) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tagSuggestions]);

  const categorySuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return TRANSACTION_CATEGORIES.filter((c) =>
      c.toLowerCase().startsWith(q)
    ).slice(0, 6);
  }, [query]);

  const tagSuggestionsFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return suggestionPoolTags.filter((t) =>
      t.toLowerCase().startsWith(q)
    ).slice(0, 10);
  }, [query, suggestionPoolTags]);

  const showDropdown =
    focused &&
    (categorySuggestions.length > 0 || tagSuggestionsFiltered.length > 0);

  return (
    <div
      ref={wrapperRef}
      className={[
        "relative",
        fullWidth ? "w-full" : "w-full min-w-0 sm:min-w-[220px] sm:max-w-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className={[
          "flex items-center gap-2 rounded-full border bg-[color:var(--color-surface)] px-3.5 py-2 text-[13px] transition-colors",
          focused
            ? "border-[color:var(--color-accent)] text-[color:var(--color-foreground)]"
            : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)]",
        ].join(" ")}
      >
        <Search className="h-4 w-4 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Cerca transazioni…"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[color:var(--color-muted-foreground)]"
          aria-label="Cerca transazioni"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Cancella ricerca"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+6px)] z-20 w-full min-w-0 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-lg sm:min-w-[220px]"
        >
          {categorySuggestions.length > 0 ? (
            <>
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                Categorie
              </div>
              {categorySuggestions.map((cat) => (
                <button
                  key={`cat-${cat}`}
                  type="button"
                  role="option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setQuery(cat);
                    setFocused(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors hover:bg-[color:var(--color-surface-muted)]"
                >
                  <span>{cat}</span>
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                    categoria
                  </span>
                </button>
              ))}
            </>
          ) : null}

          {tagSuggestionsFiltered.length > 0 ? (
            <>
              <div
                className={[
                  "px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-muted-foreground)]",
                  categorySuggestions.length > 0 ? "border-t border-[color:var(--color-border)]/60 mt-1" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                Tag
              </div>
              {tagSuggestionsFiltered.map((tag) => (
                <button
                  key={`tag-${tag}`}
                  type="button"
                  role="option"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setQuery(tag);
                    setFocused(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition-colors hover:bg-[color:var(--color-surface-muted)]"
                >
                  <span className="font-medium text-[color:var(--color-foreground)]">
                    #{tag}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                    tag
                  </span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
