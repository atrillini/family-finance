import "server-only";

/**
 * "Floor" temporale per la sincronizzazione: data minima (inclusa) a partire
 * dalla quale importiamo o conserviamo transazioni.
 *
 * Motivazione: GoCardless restituisce storici anche di 2 anni e per molti
 * utenti è troppo rumore. Definendo un floor (p.es. `2026-01-01`) otteniamo
 * tre vantaggi:
 *   1. chiediamo alla banca solo lo storico che ci serve (`dateFrom`);
 *   2. filtriamo difensivamente eventuali righe più vecchie che la banca
 *      restituisse comunque (alcune ignorano `dateFrom`);
 *   3. possiamo fare cleanup una tantum delle righe già importate e
 *      vecchie di prima del floor (vedi `/api/cleanup`).
 *
 * Il valore è configurabile via `SYNC_MIN_DATE=YYYY-MM-DD` in `.env.local`.
 * Se non impostata o malformata, ricade sul default `2026-01-01`.
 */
const DEFAULT_SYNC_MIN_DATE = "2026-01-01";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Ritorna la data-floor in formato `YYYY-MM-DD` (UTC). */
export function getSyncFloorDate(): string {
  const raw = (process.env.SYNC_MIN_DATE || "").trim();
  if (!raw) return DEFAULT_SYNC_MIN_DATE;
  if (!ISO_DATE_RE.test(raw)) {
    console.warn(
      "[sync-floor] SYNC_MIN_DATE non valido (atteso YYYY-MM-DD), uso default",
      DEFAULT_SYNC_MIN_DATE,
      "— valore ricevuto:",
      raw
    );
    return DEFAULT_SYNC_MIN_DATE;
  }
  return raw;
}

/** Date object a mezzanotte UTC del floor. */
export function getSyncFloorAsDate(): Date {
  return new Date(`${getSyncFloorDate()}T00:00:00.000Z`);
}

/**
 * Numero di giorni da oggi al floor (arrotondato per eccesso).
 * Se il floor è nel futuro ritorna 0.
 *
 * Usato per chiedere a GoCardless solo i giorni di storico necessari:
 * p.es. floor 2026-01-01 e oggi 2026-04-20 → 110 giorni, evitando di
 * chiedere i 730 gg massimi "a vuoto".
 */
export function daysSinceFloor(now: Date = new Date()): number {
  const floor = getSyncFloorAsDate();
  const diffMs = now.getTime() - floor.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Verifica che una data (ISO) sia >= floor. Accetta sia `YYYY-MM-DD` che
 * timestamp ISO completi.
 */
export function isAtOrAfterFloor(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= getSyncFloorDate();
}
