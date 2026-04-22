import type { NextRequest } from "next/server";

/**
 * Richieste inviate da Vercel Cron con env `CRON_SECRET` configurato includono:
 * `Authorization: Bearer <CRON_SECRET>`
 * @see https://vercel.com/docs/cron-jobs
 */
export function verifyCronRequest(request: NextRequest | Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length === 0) return false;
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}
