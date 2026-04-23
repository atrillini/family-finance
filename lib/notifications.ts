import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase";

export type NotificationType = "info" | "warning" | "success";

export type CreateNotificationInput = {
  type: NotificationType;
  title: string;
  message: string;
};

/**
 * Inserisce una notifica per l’utente. Usa il client Supabase della richiesta
 * (cookie session) così le RLS (`auth.uid() = user_id`) sono soddisfatte.
 *
 * @param dedupeHours se > 0, non crea una nuova riga se esiste già una notifica
 *                  con lo stesso titolo creata nell’intervallo.
 */
export async function createNotification(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: CreateNotificationInput,
  options?: { dedupeHours?: number }
): Promise<{ id: string } | { skipped: true } | { error: string }> {
  const dedupeHours = options?.dedupeHours ?? 0;
  if (dedupeHours > 0) {
    const since = new Date(
      Date.now() - dedupeHours * 3600 * 1000
    ).toISOString();
    const { data: existing } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("title", input.title)
      .gte("created_at", since)
      .limit(1);
    if (existing && existing.length > 0) {
      return { skipped: true };
    }
  }

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      user_id: userId,
      type: input.type,
      title: input.title,
      message: input.message,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[notifications] insert failed", error);
    return { error: error?.message ?? "insert fallito" };
  }
  return { id: data.id };
}

const DAY_MS = 86_400_000;

/**
 * Avvisa se il consenso GoCardless per un conto scade entro `withinDays` giorni.
 * Dedup per titolo entro 72h per non bombardare l’utente ad ogni caricamento.
 */
export async function ensureConsentExpiryNotifications(
  supabase: SupabaseClient<Database>,
  userId: string,
  options?: { withinDays?: number }
): Promise<void> {
  const withinDays = options?.withinDays ?? 7;
  const horizon = Date.now() + withinDays * DAY_MS;

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, name, consent_expires_at")
    .eq("user_id", userId)
    .not("consent_expires_at", "is", null);

  if (error || !accounts?.length) return;

  const now = Date.now();
  for (const acc of accounts) {
    const exp = acc.consent_expires_at
      ? Date.parse(acc.consent_expires_at)
      : NaN;
    if (!Number.isFinite(exp)) continue;
    if (exp <= now) continue;
    if (exp > horizon) continue;

    const daysLeft = Math.max(
      1,
      Math.ceil((exp - now) / DAY_MS)
    );
    const title = "Consenso bancario in scadenza";
    const message = `Il collegamento con ${acc.name} scadrà tra circa ${daysLeft} giorni. Rinnova il consenso su GoCardless per non perdere sincronizzazione e storico.`;

    await createNotification(
      supabase,
      userId,
      { type: "warning", title, message },
      { dedupeHours: 72 }
    );
  }
}
