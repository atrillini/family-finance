"use client";

import {
  Landmark,
  Wallet,
  PiggyBank,
  CreditCard,
  Plus,
  RefreshCw,
  Loader2,
  Pencil,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  formatCurrency,
  isPocketAccount,
  type Account,
} from "@/lib/mock-data";

type Props = {
  accounts: Account[];
  loading?: boolean;
  onAdd?: () => void;
  onSelect?: (account: Account) => void;
  onSync?: (account: Account) => void;
  onEdit?: (account: Account) => void;
  /**
   * Se passato, mostra un pulsante discreto nell'header che permette di
   * eliminare in blocco tutte le transazioni precedenti al floor (vedi
   * `SYNC_MIN_DATE` / `/api/cleanup`). Usato per la "pulizia 2026".
   */
  onCleanupHistory?: () => void;
  cleaningHistory?: boolean;
  syncingAccountIds?: Set<string>;
};

/**
 * Sezione "I miei conti" in forma di griglia responsive. Ogni card mostra:
 *   - il logo della banca (se presente `logo_url`) oppure un'icona Lucide
 *     coerente con il `type` del conto;
 *   - nome e tipo del conto;
 *   - saldo corrente formattato in euro, con colore semantico.
 *
 * Le card sono opzionalmente cliccabili: al click viene invocata `onSelect`.
 * Se l'account è stato collegato via GoCardless (ha `gocardless_account_id`)
 * viene mostrato un bottone "Sincronizza" che chiama `onSync`.
 */
export default function AccountsSection({
  accounts,
  loading,
  onAdd,
  onSelect,
  onSync,
  onEdit,
  onCleanupHistory,
  cleaningHistory,
  syncingAccountIds,
}: Props) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">
            I miei conti
          </h2>
          <p className="text-[12px] text-[color:var(--color-muted-foreground)]">
            Saldi aggiornati da Supabase · {accounts.length}{" "}
            {accounts.length === 1 ? "conto" : "conti"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onCleanupHistory ? (
            <button
              type="button"
              onClick={onCleanupHistory}
              disabled={cleaningHistory}
              title="Elimina tutte le transazioni precedenti al 1° gennaio 2026"
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-8 text-[12px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cleaningHistory ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {cleaningHistory ? "Pulizia…" : "Pulisci pre-2026"}
            </button>
          ) : null}
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-8 text-[12px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Collega Banca
            </button>
          ) : null}
        </div>
      </div>

      {loading && accounts.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="card-surface h-[112px] animate-pulse bg-[color:var(--color-surface-muted)]/40"
            />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="card-surface flex flex-col items-center justify-center gap-3 p-8 text-center text-[13px] text-[color:var(--color-muted-foreground)]">
          <p>
            Nessun conto ancora. Collega la tua banca per importare
            automaticamente le transazioni.
          </p>
          {onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 h-8 text-[12px] font-medium text-[color:var(--color-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Collega Banca
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {accounts.map((acc) => (
            <AccountCard
              key={acc.id}
              account={acc}
              onClick={onSelect ? () => onSelect(acc) : undefined}
              onSync={onSync}
              onEdit={onEdit}
              syncing={Boolean(syncingAccountIds?.has(acc.id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AccountCard({
  account,
  onClick,
  onSync,
  onEdit,
  syncing,
}: {
  account: Account;
  onClick?: () => void;
  onSync?: (account: Account) => void;
  onEdit?: (account: Account) => void;
  syncing?: boolean;
}) {
  const Icon = pickAccountIcon(account);
  const isNegative = account.balance < 0;
  const clickable = Boolean(onClick);
  const isLinked = Boolean(account.gocardless_account_id);
  const canSync = isLinked && Boolean(onSync);
  const pocket = isPocketAccount(account);

  return (
    <div
      className={[
        "card-surface group relative flex h-full w-full flex-col justify-between p-4 text-left transition-all",
        clickable
          ? "hover:-translate-y-[1px] hover:shadow-md"
          : "",
        pocket
          ? "border-[color:var(--color-accent)]/35 bg-[color:var(--color-accent)]/[0.03]"
          : "",
      ].join(" ")}
    >
      {onEdit ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(account);
          }}
          title="Modifica conto"
          aria-label="Modifica conto"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-[color:var(--color-muted-foreground)] opacity-0 transition-opacity hover:border-[color:var(--color-border)] hover:bg-[color:var(--color-surface)] hover:text-[color:var(--color-foreground)] group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)]/40"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onClick}
        disabled={!clickable}
        className={[
          "flex items-start gap-3 text-left",
          clickable
            ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40 rounded-md"
            : "cursor-default",
        ].join(" ")}
      >
        <AccountLogo account={account} Icon={Icon} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-[13.5px] font-semibold tracking-tight">
              {account.name}
            </p>
            {pocket ? (
              <span
                title="Salvadanaio: escluso dal Saldo Totale"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color:var(--color-accent)]/12 px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--color-accent)]"
              >
                <PiggyBank className="h-2.5 w-2.5" strokeWidth={2.5} />
                Salvadanaio
              </span>
            ) : null}
          </div>
          <p className="truncate text-[11px] uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
            {account.type}
          </p>
        </div>
      </button>

      <div className="mt-4 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p
            className={[
              "text-[20px] font-semibold tracking-tight leading-none tabular-nums",
              isNegative
                ? "text-[color:var(--color-expense)]"
                : "text-[color:var(--color-foreground)]",
            ].join(" ")}
          >
            {formatCurrency(account.balance)}
          </p>
          <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
            {account.last_sync_at
              ? `Agg. ${formatRelative(account.last_sync_at)}`
              : "Saldo attuale"}
          </p>
        </div>
        {canSync ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (syncing) return;
              onSync?.(account);
            }}
            disabled={syncing}
            title="Sincronizza transazioni"
            aria-label="Sincronizza transazioni"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-2 text-[11px] font-medium text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {syncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {syncing ? "Sync…" : "Sincronizza"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AccountLogo({
  account,
  Icon,
}: {
  account: Account;
  Icon: LucideIcon;
}) {
  // Se l'utente (o l'API GoCardless durante il collegamento) ha salvato un
  // logo, usiamo quello; altrimenti fallback a un'icona Lucide coerente con
  // il tipo di conto (Landmark per banche generiche).
  if (account.logo_url) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={account.logo_url}
          alt={`${account.name} logo`}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      </div>
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]">
      <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
    </div>
  );
}

/**
 * Sceglie l'icona Lucide più adatta al conto in base al `type` o al nome.
 * È una semplice euristica: `type` è testo libero impostato dall'utente,
 * quindi facciamo match case-insensitive su keyword comuni e ricadiamo su
 * `Landmark` (banca generica) per tutto il resto.
 */
function pickAccountIcon(account: Account): LucideIcon {
  const t = (account.type || "").toLowerCase();
  const n = (account.name || "").toLowerCase();
  if (t.includes("pocket") || n.includes("pocket")) return Wallet;
  if (
    t.includes("risparmio") ||
    t.includes("deposito") ||
    n.includes("risparmio") ||
    n.includes("deposito")
  ) {
    return PiggyBank;
  }
  if (t.includes("carta") || t.includes("prepagata") || n.includes("carta")) {
    return CreditCard;
  }
  return Landmark;
}

/**
 * Formatta un timestamp come "poco fa", "3 min fa", "2 h fa", altrimenti la
 * data breve. Utile per indicare quando è stato eseguito l'ultimo sync.
 */
function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "Saldo attuale";
  const diffMs = Date.now() - ts;
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60_000);
  if (min < 1) return "ora";
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h fa`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} g fa`;
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}
