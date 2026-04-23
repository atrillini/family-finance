import { createHash } from "crypto";
import type { Json } from "./supabase";
import type { GoCardlessTransaction } from "./gocardless";

/** Versione formato wrapper JSON salvato su bank_payload */
export const BANK_PAYLOAD_FORMAT_VERSION = 1;

export const DEFAULT_PARSER_VERSION = "2";

export type BankPayloadWrapper = {
  v: typeof BANK_PAYLOAD_FORMAT_VERSION;
  pending: boolean;
  capturedAt: string;
  tx: GoCardlessTransaction;
};

export function wrapBankPayload(
  tx: GoCardlessTransaction,
  pending: boolean,
): BankPayloadWrapper {
  return {
    v: BANK_PAYLOAD_FORMAT_VERSION,
    pending,
    capturedAt: new Date().toISOString(),
    tx,
  };
}

export function hashGoCardlessTransaction(tx: GoCardlessTransaction): string {
  const stable = JSON.stringify(tx);
  return createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

export function parseBankPayload(json: Json | null | undefined): BankPayloadWrapper | null {
  if (json === null || json === undefined || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }
  const o = json as Record<string, unknown>;
  const v = o.v;
  const pending = o.pending;
  const tx = o.tx;
  if (
    v !== BANK_PAYLOAD_FORMAT_VERSION ||
    typeof pending !== "boolean" ||
    tx === null ||
    typeof tx !== "object"
  ) {
    return null;
  }
  return {
    v: BANK_PAYLOAD_FORMAT_VERSION,
    pending,
    capturedAt: typeof o.capturedAt === "string" ? o.capturedAt : "",
    tx: tx as GoCardlessTransaction,
  };
}

export function bankPayloadToJson(wrapper: BankPayloadWrapper): Json {
  return wrapper as unknown as Json;
}
