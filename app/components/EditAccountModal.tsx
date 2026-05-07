"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Bug,
  Link2Off,
  Loader2,
  PiggyBank,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  ACCOUNT_TYPES,
  isPocketAccount,
  type Account,
  type AccountType,
} from "@/lib/mock-data";

export type EditAccountPatch = {
  name: string;
  type: AccountType;
  logo_url: string | null;
};

type Props = {
  account: Account | null;
  onClose: () => void;
  onSave: (id: string, patch: EditAccountPatch) => Promise<void> | void;
  /**
   * Callback di scollegamento. Quando presente e il conto è collegato a
   * GoCardless (requisition_id valorizzato), mostriamo la sezione "Scollega
   * banca" con le due opzioni: eliminare anche le transazioni sì/no, e
   * eliminare o meno l'account stesso.
   *
   * Sulla resincronizzazione di transazioni già presenti: l'indice composito
   * `(account_id, external_id)` evita i duplicati, quindi re-collegare una
   * banca e ri-sincronizzare è sicuro.
   */
  onDisconnect?: (
    id: string,
    options: { deleteTransactions: boolean; deleteAccount: boolean }
  ) => Promise<void> | void;
  /**
   * Callback per "Aggiorna descrizioni": ri-scarica le transazioni dalla
   * banca e aggiorna SOLO `description`/`merchant` sulle righe già in DB.
   * Se `recategorizeAltro` è true, rilancia Gemini sulle righe rimaste
   * in categoria "Altro" senza tag (utile per i primi sync fatti prima
   * che il parser delle descrizioni fosse stato migliorato).
   */
  onRefreshDescriptions?: (
    id: string,
    options: { recategorizeAltro: boolean }
  ) => Promise<void> | void;
  onDebugFeed?: (id: string) => Promise<{
    gocardlessAccountId: string | null;
    requisitionId: string | null;
    consentExpiresAt: string | null;
    lastSyncAtDb: string | null;
    dbBalance: number | null;
    bookedCount: number;
    pendingCount: number;
    latestTxDate: string | null;
    balanceCandidates: Array<{
      type: string;
      amount: number;
      referenceDate: string | null;
    }>;
  }>;
};

/**
 * Modal di modifica di un conto. Stesso stile del `EditTransactionModal`:
 * backdrop sfocato, chiusura con ESC, form controllato.
 *
 * I campi modificabili sono:
 *  - `name`: etichetta che l'utente vede nelle card e nei filtri;
 *  - `type`: influenza sia l'icona nella card sia — per "pocket" e
 *    "salvadanaio" — il calcolo del Saldo Totale. Contrassegnare un conto
 *    come pocket lo esclude dalla somma globale e lo mostra nella voce
 *    "di cui in salvadanai" sotto al saldo totale.
 *  - `logo_url`: URL del logo visibile nella card (GoCardless lo valorizza
 *    in automatico; qui lasciamo comunque editarlo a mano nei casi in cui
 *    l'utente voglia cambiare il logo di un conto aggiunto manualmente).
 *
 * NOTA: i campi bancari (`iban`, `balance`, `gocardless_account_id` ecc.)
 * non sono editabili dall'utente perché vengono aggiornati dal sync.
 */
export default function EditAccountModal({
  account,
  onClose,
  onSave,
  onDisconnect,
  onRefreshDescriptions,
  onDebugFeed,
}: Props) {
  const open = Boolean(account);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("conto corrente");
  const [logoUrl, setLogoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [deleteTransactions, setDeleteTransactions] = useState(false);
  const [deleteAccount, setDeleteAccount] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshRecategorize, setRefreshRecategorize] = useState(true);
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugData, setDebugData] = useState<{
    gocardlessAccountId: string | null;
    requisitionId: string | null;
    consentExpiresAt: string | null;
    lastSyncAtDb: string | null;
    dbBalance: number | null;
    bookedCount: number;
    pendingCount: number;
    latestTxDate: string | null;
    balanceCandidates: Array<{
      type: string;
      amount: number;
      referenceDate: string | null;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    setName(account.name);
    // Se il tipo salvato in DB non è uno dei canonici (stringa libera legacy)
    // cadiamo su "conto corrente" che è il default più sensato per non
    // perdere informazioni sul resto.
    const currentType = (account.type || "").toLowerCase();
    const canonical = ACCOUNT_TYPES.find(
      (t) => t === currentType || currentType.includes(t)
    );
    setType(canonical ?? "conto corrente");
    setLogoUrl(account.logo_url ?? "");
    setBusy(false);
    setDisconnecting(false);
    setDeleteTransactions(false);
    setDeleteAccount(false);
    setConfirmingDisconnect(false);
    setRefreshing(false);
    setRefreshRecategorize(true);
    setDebugBusy(false);
    setDebugData(null);
    setError(null);
  }, [account]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    if (!name.trim()) {
      setError("Il nome del conto è obbligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(account.id, {
        name: name.trim(),
        type,
        logo_url: logoUrl.trim() ? logoUrl.trim() : null,
      });
      onClose();
    } catch (err) {
      setBusy(false);
      setError(
        err instanceof Error
          ? err.message
          : "Impossibile salvare il conto. Riprova."
      );
    }
  }

  if (!open || !account) return null;

  const willBePocket =
    type === "pocket" ||
    type === "salvadanaio" ||
    isPocketAccount({ ...account, type });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-labelledby="edit-acc-title"
    >
      <button
        type="button"
        aria-label="Chiudi"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-[480px] rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="edit-acc-title"
              className="text-[18px] font-semibold tracking-tight"
            >
              Modifica conto
            </h2>
            <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">
              Aggiorna nome, tipo e logo. I salvadanai non concorrono al
              Saldo Totale.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-muted)] hover:text-[color:var(--color-foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <div>
            <Label>Nome</Label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              required
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors focus:border-[color:var(--color-accent)]"
            />
          </div>

          <div>
            <Label>Tipo</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
              disabled={busy}
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors focus:border-[color:var(--color-accent)]"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {labelForType(t)}
                </option>
              ))}
            </select>
            {willBePocket ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[color:var(--color-accent)]">
                <PiggyBank className="h-3.5 w-3.5" />
                Questo conto sarà escluso dal Saldo Totale.
              </p>
            ) : null}
          </div>

          <div>
            <Label>URL logo (opzionale)</Label>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              disabled={busy}
              placeholder="https://..."
              className="h-10 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none transition-colors placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)]"
            />
            <p className="mt-1 text-[11px] text-[color:var(--color-muted-foreground)]">
              Lascialo vuoto per usare l&apos;icona predefinita del tipo di
              conto.
            </p>
          </div>

          {error ? (
            <div className="flex items-center gap-2 rounded-xl border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/10 px-3 py-2 text-[13px] text-[color:var(--color-expense)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {onRefreshDescriptions && account.requisition_id ? (
            <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 p-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <RefreshCcw className="h-4 w-4 text-[color:var(--color-accent)]" />
                Aggiorna descrizioni
              </div>
              <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">
                Ri-scarica le transazioni dalla banca e aggiorna SOLO la{" "}
                <em>descrizione</em> e il <em>merchant</em> sulle righe già
                presenti (non vengono toccati categoria, tag, giroconti, note,
                importi o date). Utile se la banca — come Mediolanum — prima
                mandava descrizioni generiche tipo &quot;Pagamenti paesi
                UE&quot; e il nuovo parser riesce a estrarre più dettaglio.
              </p>

              <label className="mt-2 flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={refreshRecategorize}
                  onChange={(e) => setRefreshRecategorize(e.target.checked)}
                  disabled={refreshing}
                  className="mt-0.5 h-4 w-4 rounded border-[color:var(--color-border)]"
                />
                <span>
                  Rilancia anche la categorizzazione IA sulle transazioni
                  rimaste &quot;Altro&quot; senza tag (ignora le altre).
                </span>
              </label>

              <button
                type="button"
                disabled={busy || refreshing || disconnecting}
                onClick={async () => {
                  if (!account || !onRefreshDescriptions) return;
                  setRefreshing(true);
                  setError(null);
                  try {
                    await onRefreshDescriptions(account.id, {
                      recategorizeAltro: refreshRecategorize,
                    });
                    // Non chiudiamo la modale: l'utente potrebbe voler
                    // decidere altre azioni sullo stesso conto.
                    setRefreshing(false);
                  } catch (err) {
                    setRefreshing(false);
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Impossibile aggiornare le descrizioni."
                    );
                  }
                }}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-3 text-[12px] font-semibold text-[color:var(--color-accent)] transition-colors hover:bg-[color:var(--color-accent)]/15 disabled:opacity-50"
              >
                {refreshing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Aggiornamento in corso…
                  </>
                ) : (
                  <>
                    <RefreshCcw className="h-3.5 w-3.5" />
                    Aggiorna descrizioni dalla banca
                  </>
                )}
              </button>
            </div>
          ) : null}

          {onDebugFeed && account.requisition_id ? (
            <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 p-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <Bug className="h-4 w-4 text-[color:var(--color-accent)]" />
                Debug feed banca
              </div>
              <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">
                Mostra metadati tecnici del feed GoCardless (count booked/pending,
                ultima data vista, saldo candidato) per capire account stale o mismatch.
              </p>
              <button
                type="button"
                disabled={busy || disconnecting || refreshing || debugBusy}
                onClick={async () => {
                  if (!account || !onDebugFeed) return;
                  setDebugBusy(true);
                  setError(null);
                  try {
                    const data = await onDebugFeed(account.id);
                    setDebugData(data);
                  } catch (err) {
                    setError(
                      err instanceof Error
                        ? err.message
                        : "Impossibile leggere il debug feed."
                    );
                  } finally {
                    setDebugBusy(false);
                  }
                }}
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-3 text-[12px] font-semibold text-[color:var(--color-accent)] transition-colors hover:bg-[color:var(--color-accent)]/15 disabled:opacity-50"
              >
                {debugBusy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Carico debug…
                  </>
                ) : (
                  <>
                    <Bug className="h-3.5 w-3.5" />
                    Leggi debug feed
                  </>
                )}
              </button>
              {debugData ? (
                <div className="mt-3 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-2.5 text-[11.5px] leading-relaxed">
                  <p><strong>GoCardless account:</strong> {debugData.gocardlessAccountId ?? "—"}</p>
                  <p><strong>Requisition:</strong> {debugData.requisitionId ?? "—"}</p>
                  <p><strong>Consenso scade:</strong> {debugData.consentExpiresAt ?? "—"}</p>
                  <p><strong>Ultimo sync DB:</strong> {debugData.lastSyncAtDb ?? "—"}</p>
                  <p><strong>Saldo DB:</strong> {debugData.dbBalance ?? "—"}</p>
                  <p><strong>Booked/Pending:</strong> {debugData.bookedCount} / {debugData.pendingCount}</p>
                  <p><strong>Ultima data transazione feed:</strong> {debugData.latestTxDate ?? "—"}</p>
                  <p className="mt-1.5 font-semibold">Balance candidates feed:</p>
                  {debugData.balanceCandidates.length === 0 ? (
                    <p>—</p>
                  ) : (
                    <ul className="list-disc pl-4">
                      {debugData.balanceCandidates.map((b, i) => (
                        <li key={`${b.type}-${i}`}>
                          {b.type}: {b.amount} ({b.referenceDate ?? "senza data"})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {onDisconnect && account.requisition_id ? (
            <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)]/40 p-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <Link2Off className="h-4 w-4 text-[color:var(--color-expense)]" />
                Scollega banca
              </div>
              <p className="mt-1 text-[12px] text-[color:var(--color-muted-foreground)]">
                Revoca il consenso GoCardless. Il conto smetterà di
                sincronizzarsi. Se decidi di ricollegarlo in futuro, le
                transazioni già presenti non verranno duplicate grazie al
                controllo su <code>external_id</code>.
              </p>

              <div className="mt-3 space-y-1.5">
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={deleteTransactions}
                    onChange={(e) => setDeleteTransactions(e.target.checked)}
                    disabled={disconnecting}
                    className="h-4 w-4 rounded border-[color:var(--color-border)]"
                  />
                  Elimina anche tutte le transazioni di questo conto
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={deleteAccount}
                    onChange={(e) => setDeleteAccount(e.target.checked)}
                    disabled={disconnecting}
                    className="h-4 w-4 rounded border-[color:var(--color-border)]"
                  />
                  Elimina anche il conto (altrimenti resta visibile, sganciato
                  dalla banca)
                </label>
              </div>

              {confirmingDisconnect ? (
                <div className="mt-3 rounded-lg border border-[color:var(--color-expense)]/30 bg-[color:var(--color-expense)]/10 px-3 py-2 text-[12px] text-[color:var(--color-expense)]">
                  Confermi? Questa operazione non è annullabile.
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={disconnecting}
                      onClick={() => setConfirmingDisconnect(false)}
                      className="inline-flex h-8 items-center rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[12px] font-medium"
                    >
                      Annulla
                    </button>
                    <button
                      type="button"
                      disabled={disconnecting}
                      onClick={async () => {
                        if (!account || !onDisconnect) return;
                        setDisconnecting(true);
                        setError(null);
                        try {
                          await onDisconnect(account.id, {
                            deleteTransactions,
                            deleteAccount,
                          });
                          onClose();
                        } catch (err) {
                          setDisconnecting(false);
                          setConfirmingDisconnect(false);
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Impossibile scollegare la banca."
                          );
                        }
                      }}
                      className="inline-flex h-8 items-center gap-2 rounded-lg bg-[color:var(--color-expense)] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                    >
                      {disconnecting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Scollegamento…
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-3.5 w-3.5" />
                          Sì, scollega
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy || disconnecting}
                  onClick={() => setConfirmingDisconnect(true)}
                  className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-[color:var(--color-expense)]/40 bg-[color:var(--color-expense)]/10 px-3 text-[12px] font-semibold text-[color:var(--color-expense)] transition-colors hover:bg-[color:var(--color-expense)]/15 disabled:opacity-50"
                >
                  <Link2Off className="h-3.5 w-3.5" />
                  Scollega questa banca
                </button>
              )}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-[color:var(--color-border)] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="inline-flex h-10 items-center rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-[13px] font-medium transition-colors hover:bg-[color:var(--color-surface-muted)] disabled:opacity-50"
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
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Salvataggio…
                </>
              ) : (
                "Salva"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function labelForType(t: AccountType): string {
  switch (t) {
    case "conto corrente":
      return "Conto corrente";
    case "carta":
      return "Carta";
    case "pocket":
      return "Pocket (salvadanaio)";
    case "salvadanaio":
      return "Salvadanaio";
    case "risparmio":
      return "Risparmio";
    default:
      return t;
  }
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
      {children}
    </label>
  );
}
