/**
 * Prezzi indicativi Gemini (USD per 1M token). Override con env se cambiano.
 * Default allineati a richiesta prodotto: input $0.10 / 1M, output $0.40 / 1M.
 */
const DEFAULT_INPUT_PER_1M = 0.1;
const DEFAULT_OUTPUT_PER_1M = 0.4;

function priceInputPer1M(): number {
  const v = Number(process.env.GEMINI_PRICE_INPUT_PER_1M_USD);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_INPUT_PER_1M;
}

function priceOutputPer1M(): number {
  const v = Number(process.env.GEMINI_PRICE_OUTPUT_PER_1M_USD);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_OUTPUT_PER_1M;
}

export function estimateGeminiCostUsd(
  inputTokens: number,
  outputTokens: number
): number {
  const inM = Math.max(0, inputTokens) / 1_000_000;
  const outM = Math.max(0, outputTokens) / 1_000_000;
  return inM * priceInputPer1M() + outM * priceOutputPer1M();
}
