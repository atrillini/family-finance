import type { TransactionCategory } from "./gemini";
import type { Transaction } from "./mock-data";

function tagsNormalizedSorted(tags: string[] | undefined): string[] {
  return [...(tags ?? [])]
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

export function tagsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = tagsNormalizedSorted(a);
  const bb = tagsNormalizedSorted(b);
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
}

export type TransactionLabelSnapshot = {
  category: TransactionCategory;
  tags: string[];
  merchant: string | null;
  is_subscription: boolean;
  is_transfer: boolean;
};

export type TransactionLabelPatch = {
  category: TransactionCategory;
  tags: string[];
  merchant: string | null;
  is_subscription: boolean;
  is_transfer: boolean;
};

/**
 * True se l'utente ha cambiato qualcosa che influenza come l'IA dovrebbe
 * etichettare transazioni simili (few-shot), escludendo solo importo/data/conto/descrizione "cosmetica"?
 * Qui consideriamo anche merchant e flag perché sono parte dell'etichetta.
 */
export function transactionLabelsChanged(
  before: TransactionLabelSnapshot,
  after: TransactionLabelPatch
): boolean {
  if (before.category !== after.category) return true;
  if (!tagsEqual(before.tags, after.tags)) return true;
  if ((before.merchant ?? "").trim() !== (after.merchant ?? "").trim()) {
    return true;
  }
  if (Boolean(before.is_subscription) !== Boolean(after.is_subscription)) {
    return true;
  }
  if (Boolean(before.is_transfer) !== Boolean(after.is_transfer)) return true;
  return false;
}

/** Payload inviato a `/api/categorization-examples` (singolo o batch). */
export type LearningExamplePayload = {
  description: string;
  merchant: string | null;
  category: TransactionCategory;
  tags: string[];
  is_subscription: boolean;
  is_transfer: boolean;
};

export function transactionToLabelSnapshot(
  tx: Pick<
    Transaction,
    | "category"
    | "tags"
    | "merchant"
    | "is_subscription"
    | "is_transfer"
  >
): TransactionLabelSnapshot {
  return {
    category: tx.category,
    tags: [...(tx.tags ?? [])],
    merchant: tx.merchant ?? null,
    is_subscription: Boolean(tx.is_subscription),
    is_transfer: Boolean(tx.is_transfer),
  };
}

export function mergedLabelSnapshotAfterPatch(
  tx: Transaction,
  patch: Partial<
    Pick<
      Transaction,
      | "category"
      | "is_transfer"
      | "tags"
      | "merchant"
      | "is_subscription"
    >
  >
): TransactionLabelSnapshot {
  return {
    category: patch.category ?? tx.category,
    tags:
      patch.tags !== undefined ? [...patch.tags] : [...(tx.tags ?? [])],
    merchant:
      patch.merchant !== undefined ? patch.merchant : tx.merchant ?? null,
    is_subscription:
      patch.is_subscription !== undefined
        ? Boolean(patch.is_subscription)
        : Boolean(tx.is_subscription),
    is_transfer:
      patch.is_transfer !== undefined
        ? Boolean(patch.is_transfer)
        : Boolean(tx.is_transfer),
  };
}

/**
 * Costruisce gli esempi few-shot dopo un aggiornamento bulk omogeneo
 * (stesso patch applicato a tutte le righe selezionate).
 */
export function collectLearningExamplesAfterBulkPatch(
  prev: Transaction[],
  ids: string[],
  patch: Partial<
    Pick<
      Transaction,
      | "category"
      | "is_transfer"
      | "tags"
      | "merchant"
      | "is_subscription"
    >
  >
): LearningExamplePayload[] {
  const out: LearningExamplePayload[] = [];
  for (const id of ids) {
    const tx = prev.find((t) => t.id === id);
    if (!tx) continue;
    const before = transactionToLabelSnapshot(tx);
    const after = mergedLabelSnapshotAfterPatch(tx, patch);
    if (!transactionLabelsChanged(before, after)) continue;
    out.push({
      description: tx.description,
      merchant: tx.merchant ?? null,
      category: after.category,
      tags: after.tags,
      is_subscription: after.is_subscription,
      is_transfer: after.is_transfer,
    });
  }
  return out;
}
