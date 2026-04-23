import type { LearningExamplePayload } from "./categorization-learning-utils";

export type PostCategorizationExampleBody = LearningExamplePayload;

/**
 * Chiamata client → `/api/categorization-examples` dopo un salvataggio che
 * modifica etichette (vedi `transactionLabelsChanged`).
 */
export async function postCategorizationExample(
  body: PostCategorizationExampleBody
): Promise<void> {
  const res = await fetch("/api/categorization-examples", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn(
      "[postCategorizationExample]",
      res.status,
      txt.slice(0, 280)
    );
  }
}

const MAX_BATCH = 350;

/**
 * Batch di esempi (azioni massive): una sola richiesta HTTP.
 */
export async function postCategorizationExamplesBulk(
  examples: LearningExamplePayload[]
): Promise<void> {
  if (!examples.length) return;
  const slice = examples.slice(0, MAX_BATCH);
  const res = await fetch("/api/categorization-examples", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ examples: slice }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.warn(
      "[postCategorizationExamplesBulk]",
      res.status,
      txt.slice(0, 280)
    );
  }
}
