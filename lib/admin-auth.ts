import "server-only";

/**
 * Abilita route /admin e badge debug se `ADMIN_EMAIL` coincide con l’email
 * dell’utente loggato (case-insensitive).
 */
export function isAdminUserEmail(email: string | null | undefined): boolean {
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!admin) return false;
  return (email ?? "").trim().toLowerCase() === admin;
}
