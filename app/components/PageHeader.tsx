"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Search, X } from "lucide-react";
import { useHeaderSearch } from "@/lib/search-context";
import { TRANSACTION_CATEGORIES } from "@/lib/gemini";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  /** Iniziali avatar (da sessione utente). */
  avatarInitials?: string;
};

export default function PageHeader({
  title,
  subtitle,
  avatarInitials = "??",
}: PageHeaderProps) {
  const { query, setQuery } = useHeaderSearch();
  const [focused, setFocused] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Chiudi il dropdown quando si clicca fuori.
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

  // Categorie che iniziano col testo digitato (case-insensitive).
  // Mostrate solo se c'è almeno un carattere e c'è almeno un match.
  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return TRANSACTION_CATEGORIES.filter((c) =>
      c.toLowerCase().startsWith(q)
    ).slice(0, 6);
  }, [query]);

  const showDropdown = focused && suggestions.length > 0;

  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-[28px] md:text-[32px] font-semibold tracking-tight">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-[14px] text-[color:var(--color-muted-foreground)]">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <div ref={wrapperRef} className="relative">
          <div
            className={[
              "flex items-center gap-2 rounded-full border bg-[color:var(--color-surface)] px-3.5 py-2 text-[13px] min-w-[220px] transition-colors",
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
              className="flex-1 min-w-0 bg-transparent outline-none placeholder:text-[color:var(--color-muted-foreground)]"
              aria-label="Cerca transazioni"
              aria-autocomplete="list"
              aria-expanded={showDropdown}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Cancella ricerca"
                className="flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>

          {showDropdown ? (
            <div
              role="listbox"
              className="absolute right-0 top-[calc(100%+6px)] z-20 w-full min-w-[220px] overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] shadow-lg"
            >
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
                Categorie
              </div>
              {suggestions.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  role="option"
                  onMouseDown={(e) => {
                    // onMouseDown così non si perde il focus prima del click.
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

        <button
          aria-label="Notifiche"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] text-[color:var(--color-muted-foreground)] transition-colors hover:text-[color:var(--color-foreground)]"
        >
          <Bell className="h-4 w-4" />
        </button>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#5e5ce6] to-[#0a84ff] text-[12px] font-semibold text-white"
          aria-hidden
        >
          {avatarInitials.slice(0, 3)}
        </div>
      </div>
    </header>
  );
}
