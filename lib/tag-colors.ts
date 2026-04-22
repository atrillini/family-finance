/**
 * Normalizzazione coerente con il salvataggio transazioni (minuscolo, trim).
 */
export function normalizeTagLabel(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Palette fissa: stesso tag (normalizzato) → stesso indice → stessi colori ovunque.
 * Gradienti pastello con testo scuro per contrasto AA su sfondi chiari.
 */
const PALETTES: ReadonlyArray<{ background: string; color: string }> = [
  { background: "linear-gradient(135deg,#fce7f3 0%,#fbcfe8 55%,#f9a8d4 100%)", color: "#831843" },
  { background: "linear-gradient(135deg,#e0e7ff 0%,#c7d2fe 55%,#a5b4fc 100%)", color: "#312e81" },
  { background: "linear-gradient(135deg,#d1fae5 0%,#a7f3d0 55%,#6ee7b7 100%)", color: "#065f46" },
  { background: "linear-gradient(135deg,#fef3c7 0%,#fde68a 55%,#fcd34d 100%)", color: "#78350f" },
  { background: "linear-gradient(135deg,#cffafe 0%,#a5f3fc 55%,#67e8f9 100%)", color: "#155e75" },
  { background: "linear-gradient(135deg,#ede9fe 0%,#ddd6fe 55%,#c4b5fd 100%)", color: "#4c1d95" },
  { background: "linear-gradient(135deg,#ffedd5 0%,#fed7aa 55%,#fdba74 100%)", color: "#7c2d12" },
  { background: "linear-gradient(135deg,#ecfccb 0%,#d9f99d 55%,#bef264 100%)", color: "#365314" },
  { background: "linear-gradient(135deg,#ffe4e6 0%,#fecdd3 55%,#fda4af 100%)", color: "#881337" },
  { background: "linear-gradient(135deg,#e0f2fe 0%,#bae6fd 55%,#7dd3fc 100%)", color: "#0c4a6e" },
  { background: "linear-gradient(135deg,#f3e8ff 0%,#e9d5ff 55%,#d8b4fe 100%)", color: "#581c87" },
  { background: "linear-gradient(135deg,#ccfbf1 0%,#99f6e4 55%,#5eead4 100%)", color: "#115e59" },
  { background: "linear-gradient(135deg,#fef9c3 0%,#fef08a 55%,#fde047 100%)", color: "#713f12" },
  { background: "linear-gradient(135deg,#fae8ff 0%,#f5d0fe 55%,#e879f9 100%)", color: "#86198f" },
  { background: "linear-gradient(135deg,#dcfce7 0%,#bbf7d0 55%,#86efac 100%)", color: "#14532d" },
  { background: "linear-gradient(135deg,#fee2e2 0%,#fecaca 55%,#fca5a5 100%)", color: "#7f1d1d" },
  { background: "linear-gradient(135deg,#dbeafe 0%,#bfdbfe 55%,#93c5fd 100%)", color: "#1e3a8a" },
  { background: "linear-gradient(135deg,#fef08a 0%,#fde047 40%,#facc15 100%)", color: "#422006" },
  { background: "linear-gradient(135deg,#e9d5ff 0%,#d8b4fe 55%,#c084fc 100%)", color: "#4a044e" },
  { background: "linear-gradient(135deg,#bae6fd 0%,#7dd3fc 55%,#38bdf8 100%)", color: "#0c4a6e" },
];

function hashTag(normalized: string): number {
  let h = 2166136261;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function tagPaletteIndex(normalizedTag: string): number {
  if (!normalizedTag) return 0;
  return hashTag(normalizedTag) % PALETTES.length;
}

export function getTagChipStyles(tag: string): {
  background: string;
  color: string;
} {
  const key = normalizeTagLabel(tag);
  const idx = tagPaletteIndex(key);
  return PALETTES[idx] ?? PALETTES[0];
}
