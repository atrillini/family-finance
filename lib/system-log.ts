import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase";

export type SystemLogLevel = "info" | "error" | "success";
export type SystemLogModule = "Bank" | "AI" | "System";

export type CreateSystemLogInput = {
  level: SystemLogLevel;
  message: string;
  module: SystemLogModule;
  details?: Record<string, unknown>;
  tokens_input?: number;
  tokens_output?: number;
  estimated_cost?: number;
};

/**
 * Scrive una riga in `system_logs` per l’utente corrente (RLS).
 */
export async function createSystemLog(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: CreateSystemLogInput
): Promise<void> {
  const tokens_input = Math.max(0, Math.floor(input.tokens_input ?? 0));
  const tokens_output = Math.max(0, Math.floor(input.tokens_output ?? 0));
  const estimated_cost =
    typeof input.estimated_cost === "number" && Number.isFinite(input.estimated_cost)
      ? input.estimated_cost
      : 0;

  const { error } = await supabase.from("system_logs").insert({
    user_id: userId,
    level: input.level,
    message: input.message,
    module: input.module,
    details: input.details ?? {},
    tokens_input,
    tokens_output,
    estimated_cost,
  });

  if (error) {
    console.error("[system_log] insert failed", error.message);
  }
}
