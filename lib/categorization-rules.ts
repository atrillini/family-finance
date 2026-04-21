import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategorizationRuleRow, Database } from "./supabase";
import type { TransactionAnalysis } from "./gemini";

/**
 * Recupera tutte le regole di categorizzazione configurate dall'utente.
 * Ordinate per priorità decrescente: la prima regola che matcha vince.
 *
 * Se la tabella non esiste (migrazione non ancora applicata) ritorniamo un
 * array vuoto per non far esplodere le sync. Loggiamo un warning così
 * l'utente si accorge se ha saltato la migrazione.
 */
export async function loadCategorizationRules(
  supabase: SupabaseClient<Database>,
  userId: string
): Promise<CategorizationRuleRow[]> {
  const { data, error } = await supabase
    .from("categorization_rules")
    .select("*")
    .eq("user_id", userId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.warn(
      "[categorization-rules] impossibile caricare le regole:",
      error.message,
      "→ eseguo la migrazione SQL descritta in lib/supabase.ts se non l'hai ancora fatta."
    );
    return [];
  }
  return (data ?? []) as CategorizationRuleRow[];
}

/**
 * Applica le regole a una transazione. Ritorna un `TransactionAnalysis`
 * pronto da salvare se una regola matcha, altrimenti `null` (si delega a
 * Gemini). Le regole sono già ordinate per priorità.
 */
export function applyRules(
  rules: CategorizationRuleRow[],
  description: string,
  merchant: string | null
): (TransactionAnalysis & { is_transfer: boolean; matchedRuleId: string }) | null {
  const desc = (description ?? "").toLowerCase();
  const merch = (merchant ?? "").toLowerCase();
  for (const rule of rules) {
    const pattern = (rule.pattern ?? "").trim();
    if (!pattern) continue;

    let matches = false;
    try {
      switch (rule.match_type) {
        case "merchant_contains":
          matches = merch.includes(pattern.toLowerCase());
          break;
        case "description_regex": {
          const re = new RegExp(pattern, "i");
          matches = re.test(description ?? "");
          break;
        }
        case "description_contains":
        default:
          matches = desc.includes(pattern.toLowerCase());
          break;
      }
    } catch {
      // regex malformata → ignora la regola
      matches = false;
    }

    if (matches) {
      return {
        category: rule.category,
        merchant: rule.merchant ?? "",
        tags: Array.isArray(rule.tags) ? [...rule.tags] : [],
        is_subscription: Boolean(rule.is_subscription),
        is_transfer: Boolean(rule.is_transfer),
        matchedRuleId: rule.id,
      };
    }
  }
  return null;
}

/**
 * Serializza le regole in una stringa da iniettare nel prompt di Gemini.
 * Max 25 regole per non esplodere il contesto.
 */
export function formatRulesForPrompt(
  rules: CategorizationRuleRow[]
): string {
  if (!rules.length) return "";
  const top = rules.slice(0, 25);
  const lines = top.map((r, i) => {
    const tagsPart = r.tags?.length ? ` | tags: ${r.tags.join(", ")}` : "";
    const merchantPart = r.merchant ? ` | merchant: ${r.merchant}` : "";
    const subPart = r.is_subscription ? " | is_subscription: true" : "";
    const transferPart = r.is_transfer ? " | is_transfer: true" : "";
    const notePart = r.note ? ` | nota: ${r.note}` : "";
    return `${i + 1}. Se ${labelForMatch(r.match_type)} "${r.pattern}" → category: ${r.category}${merchantPart}${tagsPart}${subPart}${transferPart}${notePart}`;
  });
  return lines.join("\n");
}

function labelForMatch(match: CategorizationRuleRow["match_type"]): string {
  switch (match) {
    case "merchant_contains":
      return "il merchant contiene";
    case "description_regex":
      return "la descrizione matcha la regex";
    case "description_contains":
    default:
      return "la descrizione contiene";
  }
}
