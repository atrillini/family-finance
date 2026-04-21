/**
 * Registrazione pubblica dalla pagina `/register`.
 *
 * - Default: **chiusa** (adatto a un’app personale).
 * - Imposta `NEXT_PUBLIC_REGISTRATION_OPEN=true` in `.env.local` solo se vuoi
 *   riaprire temporaneamente la pagina di iscrizione nell’app.
 *
 * Per impedire iscrizioni anche tramite API Supabase, nel progetto Supabase:
 * Authentication → **disabilita le nuove iscrizioni** (o crea gli utenti solo da
 * Dashboard / “Invite user”). Vedi commento in PROXY o nella doc Supabase Auth.
 */
export function isPublicRegistrationOpen(): boolean {
  return process.env.NEXT_PUBLIC_REGISTRATION_OPEN === "true";
}
