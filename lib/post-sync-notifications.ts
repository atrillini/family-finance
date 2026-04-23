import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase";
import { createNotification } from "./notifications";

type CategorizationRow = {
  category?: string | null;
  tags?: string[] | null;
};

/**
 * Dopo un sync, genera notifiche lato server in base a errori Gemini e
 * transazioni lasciate in "Altro" senza tag.
 */
export async function notifyAfterSync(
  supabase: SupabaseClient<Database>,
  userId: string,
  ctx: {
    accountName: string;
    aiFailed: number;
    uncertainInserts: number;
    hadBatch: boolean;
  }
): Promise<void> {
  if (!ctx.hadBatch) return;

  if (ctx.aiFailed > 0) {
    await createNotification(
      supabase,
      userId,
      {
        type: "warning",
        title: "Categorizzazione IA incompleta",
        message: `Durante l'ultima sincronizzazione su “${ctx.accountName}” l'IA non ha potuto classificare ${ctx.aiFailed} transazion${ctx.aiFailed === 1 ? "e" : "i"}. Controlla le voci in categoria “Altro” o rilancia la categorizzazione.`,
      },
      { dedupeHours: 6 }
    );
  }

  if (ctx.uncertainInserts > 0) {
    await createNotification(
      supabase,
      userId,
      {
        type: "info",
        title: "Transazioni da verificare",
        message: `Ci sono ${ctx.uncertainInserts} nuove transazion${ctx.uncertainInserts === 1 ? "e" : "i"} in “Altro” senza tag. Dalle un'occhiata quando puoi per allineare categorie e abbonamenti.`,
      },
      { dedupeHours: 12 }
    );
  }
}

/** Conta le righe con categoria "Altro" e nessun tag (batch inserito). */
export function countUncertainFromInserts(
  rows: CategorizationRow[]
): number {
  return rows.filter(
    (r) =>
      (r.category ?? "").trim() === "Altro" &&
      (!r.tags || r.tags.length === 0)
  ).length;
}
