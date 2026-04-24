import type { Account, Transaction } from "./mock-data";

const SEP = ";";

/** Campo CSV sicuro per Excel (IT): separatore `;`, virgola decimale negli importi. */
function escapeField(raw: string): string {
  const s = String(raw ?? "");
  if (/[";\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function accountName(accounts: Account[], accountId: string | null): string {
  if (!accountId) return "";
  const a = accounts.find((x) => x.id === accountId);
  return a?.name ?? "";
}

/** Importo in formato italiano (virgola decimale), senza simbolo € nella cella. */
function formatAmountIt(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const [intRaw, decRaw = "00"] = abs.toFixed(2).split(".");
  const intWithSep = intRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${intWithSep},${decRaw}`;
}

function isoDateOnly(iso: string): string {
  const s = String(iso ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sortByDateAsc(rows: Transaction[]): Transaction[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.date).getTime();
    const tb = new Date(b.date).getTime();
    return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
  });
}

export type CommercialistaCsvOptions = {
  /** Es. etichetta periodo o “selezione” — solo in prima riga commento. */
  note?: string;
};

/**
 * CSV separato da `;`, UTF-8 con BOM, adatto a commercialista / Excel italiano.
 * Colonne: data, descrizione, merchant, categoria, importo (IT), entrata/uscita,
 * tags, conto, giroconto, abbonamento, id, id_esterno.
 */
export function buildCommercialistaCsv(
  rows: Transaction[],
  accounts: Account[],
  opts?: CommercialistaCsvOptions
): string {
  const sorted = sortByDateAsc(rows);
  const header = [
    "data",
    "descrizione",
    "merchant",
    "categoria",
    "importo",
    "tipo",
    "tag",
    "conto",
    "giroconto",
    "abbonamento",
    "id",
    "id_esterno",
  ].join(SEP);

  const lines: string[] = [];
  if (opts?.note?.trim()) {
    lines.push(`${escapeField(`# ${opts.note.trim()}`)}`);
  }
  lines.push(header);

  for (const tx of sorted) {
    const amount = Number(tx.amount ?? 0);
    const tipo = amount >= 0 ? "entrata" : "uscita";
    const tags = Array.isArray(tx.tags) ? tx.tags.join(" | ") : "";
    const row = [
      escapeField(isoDateOnly(tx.date)),
      escapeField(tx.description ?? ""),
      escapeField(tx.merchant ?? ""),
      escapeField(tx.category ?? ""),
      escapeField(formatAmountIt(amount)),
      escapeField(tipo),
      escapeField(tags),
      escapeField(accountName(accounts, tx.account_id ?? null)),
      escapeField(tx.is_transfer ? "sì" : "no"),
      escapeField(tx.is_subscription ? "sì" : "no"),
      escapeField(tx.id ?? ""),
      escapeField(tx.external_id ?? ""),
    ].join(SEP);
    lines.push(row);
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function commercialistaCsvFilename(prefix: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}_${stamp}.csv`;
}
