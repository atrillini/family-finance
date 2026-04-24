import type { Account } from "@/lib/mock-data";

/** Nome e tipo del conto dedicato alle uscite in contanti (Pacchetto 3). */
export const CASH_WALLET_NAME = "Contanti";
export const CASH_WALLET_TYPE = "contanti";

/** Evento globale per allineare la lista conti dopo creazione wallet contanti. */
export const REFETCH_ACCOUNTS_EVENT = "familyfinance:refetch-accounts";

export function dispatchRefetchAccounts(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REFETCH_ACCOUNTS_EVENT));
}

export function findCashWalletInAccounts(
  accounts: readonly Account[]
): Account | undefined {
  const nameLc = CASH_WALLET_NAME.toLowerCase();
  const typeLc = CASH_WALLET_TYPE.toLowerCase();
  return accounts.find((a) => {
    const n = (a.name || "").trim().toLowerCase();
    const t = (a.type || "").trim().toLowerCase();
    return n === nameLc || t === typeLc;
  });
}

/**
 * Estrae un importo in euro dalla riga libera: prima cerca €/euro, poi un
 * numero all'inizio della stringa (es. "20 pizza", "€12 bar").
 */
export function extractCashExpenseAmount(text: string): number | null {
  const s = text.trim();
  if (!s) return null;

  const withCurrency = s.match(
    /(?:€\s*)(\d{1,6}(?:[.,]\d{1,2})?)|(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)\b/i
  );
  if (withCurrency) {
    const raw = (withCurrency[1] ?? withCurrency[2])!;
    const n = Number.parseFloat(raw.replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) return n;
  }

  const atStart = s.match(/^(?:€\s*)?(\d{1,6}(?:[.,]\d{1,2})?)\b/);
  if (atStart) {
    const n = Number.parseFloat(atStart[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0 && n < 1_000_000) return n;
  }

  return null;
}
