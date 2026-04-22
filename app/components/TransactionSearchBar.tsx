"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useHeaderSearch } from "@/lib/search-context";
import { TRANSACTION_CATEGORIES } from "@/lib/gemini";

type Props = {
  className?: string;
  /** Se true, il campo occupa tutta la larghezza del contenitore (es. sotto al titolo su mobile) */
  fullWidth?: boolean;
};

/**
 * Campo di ricerca testuale sulle transazioni (stato globale via `useHeaderSearch`).
 * Stessa logica e suggerimenti categoria che erano in `PageHeader`, spostata
 * accanto / sopra la tabella per comodità.
 */
export default function TransactionSearchBar({
  className = "",
  fullWidth = false,
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

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return TRANSACTION_CATEGORIES.filter((c) =>
      c.toLowerCase().startsWith(q)
    ).slice(0, 6);
  }, [query]);

  const showDropdown = focused && suggestions.length > 0;

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
          <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
            Categorie
          </div>
          {suggestions.map((cat) => (
            <button
              key={cat}
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
        </div>
      ) : null}
    </div>
  );
}
