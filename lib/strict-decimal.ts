/**
 * Input numerici “chiari” per l’utente: separatore decimale solo il punto (.).
 * Con la virgola (,) si mostra un messaggio esplicito invece di convertire in silenzio.
 */

export const COMMA_NOT_ALLOWED_MSG =
  "Usa il punto (.) come separatore decimale, non la virgola. Esempio: 1234.56";

const MULTIPLE_DOTS =
  "Formato non valido: al massimo un punto per le cifre decimali.";

function hasComma(s: string): boolean {
  return s.includes(",");
}

/**
 * @param min — incluso; applicato se value non è null
 * @param allowNullWhenEmpty — se true e stringa vuota, restituisce null
 */
export function parseStrictDecimal(
  raw: string,
  options: { label: string; required: boolean; min: number; allowNullWhenEmpty: boolean }
):
  | { ok: true; value: number | null }
  | { ok: false; message: string } {
  const s = raw.trim();
  if (!s) {
    if (options.required) {
      return {
        ok: false,
        message: `${options.label} è obbligatorio.`,
      };
    }
    if (options.allowNullWhenEmpty) {
      return { ok: true, value: null };
    }
    return {
      ok: false,
      message: `${options.label} è obbligatorio.`,
    };
  }
  if (hasComma(s)) {
    return { ok: false, message: `${options.label}: ${COMMA_NOT_ALLOWED_MSG}` };
  }
  if ((s.match(/\./g) ?? []).length > 1) {
    return { ok: false, message: `${options.label}: ${MULTIPLE_DOTS}` };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      message: `${options.label}: inserisci un numero valido (solo cifre e un punto per i decimali).`,
    };
  }
  if (n < options.min) {
    return {
      ok: false,
      message: `${options.label}: inserisci un valore ≥ ${options.min}.`,
    };
  }
  return { ok: true, value: n };
}

/** Stesso criterio senza vincolo di minimo (utile a percentuali che possono essere 0 o negative se serve). */
export function parseStrictDecimalUnbounded(
  raw: string,
  options: { label: string; allowEmpty: boolean }
):
  | { ok: true; value: number | null }
  | { ok: false; message: string } {
  const s = raw.trim();
  if (!s) {
    if (options.allowEmpty) return { ok: true, value: null };
    return { ok: false, message: `${options.label} è obbligatorio.` };
  }
  if (hasComma(s)) {
    return { ok: false, message: `${options.label}: ${COMMA_NOT_ALLOWED_MSG}` };
  }
  if ((s.match(/\./g) ?? []).length > 1) {
    return { ok: false, message: `${options.label}: ${MULTIPLE_DOTS}` };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      message: `${options.label}: inserisci un numero valido (solo cifre e un punto per i decimali).`,
    };
  }
  return { ok: true, value: n };
}

export function parseStrictIntYears(
  raw: string,
  options: { label: string; min: number; max: number }
):
  | { ok: true; value: number }
  | { ok: false; message: string } {
  const s = raw.trim();
  if (!s) {
    return { ok: false, message: `${options.label} è obbligatorio.` };
  }
  if (hasComma(s)) {
    return { ok: false, message: `${options.label}: ${COMMA_NOT_ALLOWED_MSG}` };
  }
  if (s.includes(".")) {
    return {
      ok: false,
      message: `${options.label}: indica un numero intero di anni (es. 10, senza decimali).`,
    };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return {
      ok: false,
      message: `${options.label}: inserisci un numero intero (es. 10).`,
    };
  }
  if (n < options.min || n > options.max) {
    return {
      ok: false,
      message: `${options.label}: inserisci un valore tra ${options.min} e ${options.max}.`,
    };
  }
  return { ok: true, value: n };
}
