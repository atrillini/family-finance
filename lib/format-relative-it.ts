/**
 * Formatta un timestamp come "ora", "3 min fa", "2 h fa", ecc. (italiano breve).
 * Usabile lato server e client.
 */
export function formatRelativeShort(iso: string, nowMs: number = Date.now()): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "—";
  const diffMs = nowMs - ts;
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
