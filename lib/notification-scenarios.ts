import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase";
import { createNotification, type NotificationType } from "./notifications";

/**
 * Esempi pronti (testi stile prodotto) da collegare a job, cron o analisi IA.
 * Tutte rispettano `createNotification` con dedup laddove indicato.
 */
export async function notifySpendingAnomaly(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { merchant: string; typicalEur: number; spentEur: number }
) {
  return createNotification(
    supabase,
    userId,
    {
      type: "warning",
      title: "Spesa anomala",
      message: `Ehi, hai appena speso ${input.spentEur.toFixed(0)}€ da ${input.merchant}, solitamente ne spendi ~${input.typicalEur.toFixed(0)}€. Vuoi che controlli la categoria?`,
    },
    { dedupeHours: 12 }
  );
}

export async function notifyNewSubscription(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { name: string }
) {
  return createNotification(
    supabase,
    userId,
    {
      type: "info",
      title: "Nuovo abbonamento",
      message: `Abbiamo rilevato un nuovo addebito ricorrente (es. ${input.name}). Lo aggiungo alla lista degli abbonamenti?`,
    },
    { dedupeHours: 24 }
  );
}

export async function notifyUncategorizedBatch(
  supabase: SupabaseClient<Database>,
  userId: string,
  count: number
) {
  if (count <= 0) return { skipped: true as const };
  return createNotification(
    supabase,
    userId,
    {
      type: "warning",
      title: "Transazioni da categorizzare",
      message: `Ci sono ${count} nuove transazioni che non sono riuscito a taggare con certezza. Mi dai una mano?`,
    },
    { dedupeHours: 6 }
  );
}

export async function notifyRestaurantsGoal(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { percentLess: number; savedEur: number }
) {
  return createNotification(
    supabase,
    userId,
    {
      type: "success",
      title: "Obiettivo raggiunto",
      message: `Grande! Questa settimana hai speso il ${input.percentLess}% in meno in "Ristoranti" rispetto alla tua media. ${input.savedEur.toFixed(0)}€ risparmiati!`,
    },
    { dedupeHours: 72 }
  );
}

/** Aiuta test manuali dalla console server o route di prova. */
export async function notifyGeneric(
  supabase: SupabaseClient<Database>,
  userId: string,
  type: NotificationType,
  title: string,
  message: string
) {
  return createNotification(supabase, userId, { type, title, message });
}
