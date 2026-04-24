import "server-only";

/**
 * Elenco email admin: `ADMIN_EMAILS` (separate da virgola o `;`) oppure,
 * in retrocompatibilità, una sola `ADMIN_EMAIL`. Confronto case-insensitive.
 */
function parseAdminEmailList(): string[] {
  const raw =
    process.env.ADMIN_EMAILS?.trim() ||
    process.env.ADMIN_EMAIL?.trim() ||
    "";
  if (!raw) return [];
  return raw
    .split(/[,;]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Abilita route `/admin/*`, badge log e voce sidebar se l’email dell’utente
 * è nell’elenco configurato sul server.
 */
export function isAdminUserEmail(email: string | null | undefined): boolean {
  const list = parseAdminEmailList();
  if (!list.length) return false;
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  return list.includes(e);
}
