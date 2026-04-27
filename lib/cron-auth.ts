import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Vercel Cron: `Authorization: Bearer <CRON_SECRET>`
 * @see https://vercel.com/docs/cron-jobs
 */
function verifyVercelCronBearer(request: NextRequest | Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

/**
 * Cron esterno (es. cron-job.org):
 * `x-cron-key: <CRON_EXTERNAL_KEY>` (stessa chiave in Vercel → Environment Variables)
 */
function verifyExternalCronKeyHeader(request: NextRequest | Request): boolean {
  const expected = process.env.CRON_EXTERNAL_KEY?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-cron-key");
  if (provided == null) return false;
  try {
    const a = Buffer.from(provided, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Consente l’esecuzione del cron se è configurata almeno una chiave valida
 * (Vercel o esterna) e l’header corrisponde.
 */
export function verifyCronRequest(request: NextRequest | Request): boolean {
  if (verifyVercelCronBearer(request)) return true;
  if (verifyExternalCronKeyHeader(request)) return true;
  return false;
}

/** true se c’è almeno un metodo di autenticazione cron configurato. */
export function isAnyCronAuthConfigured(): boolean {
  return Boolean(
    process.env.CRON_SECRET?.trim() || process.env.CRON_EXTERNAL_KEY?.trim()
  );
}
