"use client";

import { useEffect, useState } from "react";
import { Users, Loader2 } from "lucide-react";

type Row = {
  id: string;
  email: string | undefined;
  created_at: string | undefined;
  last_sign_in_at: string | undefined;
};

export default function ProjectUsersList() {
  const [loading, setLoading] = useState(true);
  const [listSupported, setListSupported] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [users, setUsers] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/project-users");
        const data = (await res.json()) as {
          ok?: boolean;
          listSupported?: boolean;
          hint?: string;
          users?: Row[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Errore caricamento utenti");
          return;
        }
        setListSupported(Boolean(data.listSupported));
        setHint(data.hint ?? null);
        setUsers(Array.isArray(data.users) ? data.users : []);
      } catch {
        if (!cancelled) setError("Impossibile caricare la lista utenti.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="card-surface p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-surface-muted)]">
          <Users className="h-[18px] w-[18px]" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14.5px] font-semibold">Utenti registrati</p>
          <p className="mt-0.5 text-[13px] text-[color:var(--color-muted-foreground)]">
            Account creati nel progetto Supabase (Auth). Serve la chiave di
            servizio server-side per elencarli qui.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-[color:var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Caricamento…
        </div>
      ) : error ? (
        <p className="text-[13px] text-[color:var(--color-expense)]">{error}</p>
      ) : !listSupported ? (
        <p className="rounded-xl border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-muted)]/50 p-4 text-[13px] leading-snug text-[color:var(--color-muted-foreground)]">
          {hint ??
            "Configura SUPABASE_SERVICE_ROLE_KEY in .env.local per mostrare l’elenco, oppure apri il pannello Supabase → Authentication → Users."}
        </p>
      ) : users.length === 0 ? (
        <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
          Nessun utente trovato.
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--color-border)] rounded-xl border border-[color:var(--color-border)] overflow-hidden">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex flex-col gap-0.5 px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="font-medium">{u.email ?? u.id}</span>
              <span className="text-[color:var(--color-muted-foreground)]">
                creato{" "}
                {u.created_at
                  ? new Date(u.created_at).toLocaleString("it-IT")
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
