"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Stato condiviso del testo cercato nella barra dell'header.
 * Viene scritto da `PageHeader` (client) e letto da `DashboardClient`
 * per filtrare in tempo reale descrizione, esercente e tag delle transazioni.
 *
 * Il provider è montato in `app/layout.tsx` attorno a `{children}` in modo da
 * coprire sia i server components (che poi includono client components) sia
 * gli alberi tipicamente client di una pagina.
 */
type SearchContextValue = {
  query: string;
  setQuery: (q: string) => void;
};

const SearchContext = createContext<SearchContextValue | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const value = useMemo(() => ({ query, setQuery }), [query]);
  return (
    <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
  );
}

/**
 * Hook per leggere/scrivere il testo della ricerca dell'header.
 * Se il provider non è montato (es. in test isolati) ritorna uno stato
 * "noop" così i componenti restano safe da crash.
 */
export function useHeaderSearch(): SearchContextValue {
  const ctx = useContext(SearchContext);
  if (!ctx) {
    return { query: "", setQuery: () => {} };
  }
  return ctx;
}
