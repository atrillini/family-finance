"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Landmark,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

type Bank = {
  id: string;
  name: string;
  bic?: string;
  logo?: string;
  countries?: string[];
  transaction_total_days?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Codice ISO del paese da mostrare. Default "IT". */
  country?: string;
};

/**
 * Modal per collegare un conto bancario tramite GoCardless.
 *
 * - Scarica la lista banche da `/api/banks?country=XX`
 * - Permette di filtrare per nome
 * - Al click su una banca richiede a `/api/connect` il link di consenso e
 *   reindirizza l'utente al flusso di autorizzazione dell'istituto
 * - Al ritorno l'utente atterra su `/api/callback` e da lì sulla dashboard
 *   con `?bank=connected` (gestito in `DashboardClient`).
 */
export default function ConnectBankDialog({
  open,
  onClose,
  country = "IT",
}: Props) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(
          `/api/banks?country=${encodeURIComponent(country)}`
        );
        const json = await resp.json();
        if (!resp.ok) {
          throw new Error(json?.error ?? "Errore nel caricamento delle banche");
        }
        if (!cancelled) {
          setBanks(Array.isArray(json?.banks) ? json.banks : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Impossibile caricare la lista delle banche."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [open, country]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return banks;
    return banks.filter((b) => b.name.toLowerCase().includes(q));
  }, [banks, query]);

  async function handleConnect(bank: Bank) {
    if (connectingId) return;
    setConnectingId(bank.id);
    try {
      const resp = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutionId: bank.id }),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.link) {
        throw new Error(
          json?.error ?? "Impossibile generare il link di consenso."
        );
      }
      toast.message(`Apro ${bank.name}…`, {
        description:
          "Sarai reindirizzato al tuo istituto per autorizzare l'accesso.",
      });
      window.location.href = json.link as string;
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Errore durante la connessione bancaria."
      );
      setConnectingId(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 backdrop-blur-sm md:items-center"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Collega una banca"
        className="card-surface flex h-[min(80vh,640px)] w-full max-w-lg flex-col overflow-hidden p-0 shadow-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[color:var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">
              Collega una banca
            </h2>
            <p className="truncate text-[12px] text-[color:var(--color-muted-foreground)]">
              Scegli il tuo istituto per importare le transazioni via Open
              Banking (GoCardless).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
            aria-label="Chiudi"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-[color:var(--color-border)] px-5 py-3">
          <div className="flex items-center gap-2 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] px-3 h-9">
            <Search className="h-3.5 w-3.5 text-[color:var(--color-muted-foreground)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca banca (es. Intesa, Revolut, Fineco…)"
              className="flex-1 bg-transparent text-[13px] placeholder:text-[color:var(--color-muted-foreground)] focus:outline-none"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-[11px] text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]"
              >
                Azzera
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="m-5 flex items-start gap-3 rounded-lg border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/5 p-4 text-[13px] text-[color:var(--color-expense)]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          ) : loading && banks.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-8 text-[13px] text-[color:var(--color-muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carico le banche italiane…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[color:var(--color-muted-foreground)]">
              Nessuna banca trovata per “{query}”.
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)]">
              {filtered.map((bank) => {
                const isConnecting = connectingId === bank.id;
                return (
                  <li key={bank.id}>
                    <button
                      type="button"
                      onClick={() => handleConnect(bank)}
                      disabled={Boolean(connectingId)}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <BankLogo bank={bank} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium tracking-tight">
                          {bank.name}
                        </p>
                        {bank.bic ? (
                          <p className="truncate text-[11px] text-[color:var(--color-muted-foreground)]">
                            {bank.bic}
                          </p>
                        ) : null}
                      </div>
                      {isConnecting ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[color:var(--color-accent)]" />
                      ) : (
                        <span className="text-[11px] font-medium text-[color:var(--color-accent)]">
                          Collega →
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="border-t border-[color:var(--color-border)] px-5 py-3 text-[11px] text-[color:var(--color-muted-foreground)]">
          I dati sono letti in sola lettura tramite GoCardless Bank Account
          Data. Puoi revocare l'accesso in qualsiasi momento.
        </footer>
      </div>
    </div>
  );
}

function BankLogo({ bank }: { bank: Bank }) {
  if (bank.logo) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bank.logo}
          alt={`${bank.name} logo`}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      </div>
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-surface-muted)]">
      <Landmark className="h-[18px] w-[18px]" strokeWidth={2} />
    </div>
  );
}
