/**
 * Proiezione deterministica (interessi composti mensili + versamenti a fine mese).
 * I numeri sono calcolati in app; eventuale testo Gemini usa solo questi aggregati.
 */

export type InvestmentScenarioInput = {
  /** Capitale iniziale (es. somma valore attuale posizioni + opzionale liquidità). */
  startingPrincipal: number;
  /** Rendimento annuo nominale in % (es. 4 = 4%). */
  annualReturnPct: number;
  /** Versamento netto a fine mese (€). */
  monthlyContribution: number;
  /** Orizzonte in anni (intero, clamp 1–40). */
  horizonYears: number;
};

export type InvestmentScenarioResult = {
  months: number;
  endValue: number;
  totalContributions: number;
  /** Parte del guadagno oltre capitale iniziale e versamenti (effetto rendimento). */
  marketComponent: number;
};

export function computeInvestmentScenario(
  input: InvestmentScenarioInput
): InvestmentScenarioResult | null {
  const years = Math.min(40, Math.max(1, Math.floor(Number(input.horizonYears))));
  const months = years * 12;
  const PV = Number(input.startingPrincipal);
  if (!Number.isFinite(PV) || PV < 0) return null;
  const pmt = Math.max(0, Number(input.monthlyContribution));
  if (!Number.isFinite(pmt)) return null;
  const apr = Number(input.annualReturnPct);
  if (!Number.isFinite(apr)) return null;

  const r = apr / 100 / 12;
  let fv: number;
  if (Math.abs(r) < 1e-14) {
    fv = PV + pmt * months;
  } else {
    const factor = (1 + r) ** months;
    fv = PV * factor + (pmt * (factor - 1)) / r;
  }

  const totalContributions = pmt * months;
  const marketComponent = fv - PV - totalContributions;
  return {
    months,
    endValue: fv,
    totalContributions,
    marketComponent,
  };
}
