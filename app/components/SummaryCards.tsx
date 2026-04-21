import { ArrowDownLeft, ArrowUpRight, PiggyBank, Wallet } from "lucide-react";
import {
  formatCurrency,
  percentDelta,
  type MonthlySummary,
} from "@/lib/mock-data";

type SummaryCardsProps = {
  summary: MonthlySummary;
  monthLabel: string;
  /**
   * Somma dei conti contrassegnati come salvadanaio/pocket. Se `> 0` viene
   * mostrata come sottotitolo informativo del Saldo Totale, così l'utente
   * capisce a colpo d'occhio che quei soldi esistono ma non sono stati
   * inclusi nella cifra principale.
   */
  pocketBalance?: number;
  /**
   * Dati del periodo precedente (stessa durata del range corrente, o "mese
   * scorso" se nessun range è selezionato). Servono a calcolare il delta %
   * live delle card Entrate/Uscite.
   */
  previous?: { income: number; expenses: number } | null;
};

export default function SummaryCards({
  summary,
  monthLabel,
  pocketBalance,
  previous,
}: SummaryCardsProps) {
  const incomeDelta = previous ? percentDelta(summary.income, previous.income) : null;
  const expensesDelta = previous
    ? percentDelta(summary.expenses, previous.expenses)
    : null;

  return (
    <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <HeroBalanceCard
        balance={summary.balance}
        monthLabel={monthLabel}
        pocketBalance={pocketBalance}
      />

      <StatCard
        label="Entrate"
        value={summary.income}
        monthLabel={monthLabel}
        tone="income"
        icon={<ArrowDownLeft className="h-4 w-4" strokeWidth={2.5} />}
        delta={incomeDelta}
        // Per le entrate, un aumento è positivo.
        positiveIsGood
      />

      <StatCard
        label="Uscite"
        value={summary.expenses}
        monthLabel={monthLabel}
        tone="expense"
        icon={<ArrowUpRight className="h-4 w-4" strokeWidth={2.5} />}
        delta={expensesDelta}
        // Per le uscite una diminuzione è positiva.
        positiveIsGood={false}
      />
    </section>
  );
}

function HeroBalanceCard({
  balance,
  monthLabel,
  pocketBalance,
}: {
  balance: number;
  monthLabel: string;
  pocketBalance?: number;
}) {
  const showPocket =
    typeof pocketBalance === "number" && Math.abs(pocketBalance) > 0.009;

  return (
    <div className="hero-card p-6 md:p-7 min-h-[180px] flex flex-col justify-between">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm">
            <Wallet className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-white/60">
              Saldo totale
            </p>
            <p className="text-[12px] text-white/80">{monthLabel}</p>
          </div>
        </div>
        <span className="text-[11px] font-medium tracking-wider text-white/60">
          FAMILY · 01
        </span>
      </div>

      <div>
        <p className="text-[36px] md:text-[40px] font-semibold tracking-tight leading-none">
          {formatCurrency(balance)}
        </p>
        {showPocket ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[12px] font-medium text-white/85 backdrop-blur-sm">
            <PiggyBank className="h-3.5 w-3.5" strokeWidth={2.5} />
            di cui {formatCurrency(pocketBalance!)} nei salvadanai (esclusi)
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-white/70">
            Aggiornato oggi · esclusi salvadanai
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  monthLabel,
  tone,
  icon,
  delta,
  positiveIsGood,
}: {
  label: string;
  value: number;
  monthLabel: string;
  tone: "income" | "expense";
  icon: React.ReactNode;
  /**
   * Variazione percentuale vs periodo precedente. `null` = non disponibile
   * (periodo precedente a 0 o non pervenuto): in quel caso non mostriamo
   * alcuna etichetta.
   */
  delta: number | null;
  /**
   * `true` per le entrate: un valore positivo del delta viene mostrato in
   * verde. `false` per le uscite: un aumento è negativo (rosso).
   */
  positiveIsGood: boolean;
}) {
  const toneStyles =
    tone === "income"
      ? "bg-[color:var(--color-income)]/12 text-[color:var(--color-income)]"
      : "bg-[color:var(--color-expense)]/12 text-[color:var(--color-expense)]";

  // Decide colore/segno del badge del delta.
  let badgeClass = "bg-black/5 text-[color:var(--color-muted-foreground)]";
  let badgeText = "—";
  if (delta !== null && Number.isFinite(delta)) {
    const isIncrease = delta > 0;
    const isDecrease = delta < 0;
    const isGood = positiveIsGood ? isIncrease : isDecrease;
    const isBad = positiveIsGood ? isDecrease : isIncrease;
    const sign = isIncrease ? "+" : isDecrease ? "" : "";
    const pretty = `${sign}${delta.toFixed(1).replace(".", ",")}%`;
    badgeText = pretty;
    if (isGood)
      badgeClass =
        "bg-[color:var(--color-income)]/12 text-[color:var(--color-income)]";
    else if (isBad)
      badgeClass =
        "bg-[color:var(--color-expense)]/12 text-[color:var(--color-expense)]";
  }

  return (
    <div className="card-surface p-6 flex flex-col justify-between min-h-[180px]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-xl ${toneStyles}`}
          >
            {icon}
          </div>
          <div>
            <p className="text-[13px] font-medium text-[color:var(--color-muted-foreground)]">
              {label}
            </p>
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]/80">
              {monthLabel}
            </p>
          </div>
        </div>
        <span
          className={`text-[11px] font-semibold rounded-full px-2 py-1 ${badgeClass}`}
          title={
            delta === null
              ? "Nessun dato nel periodo precedente"
              : "Variazione rispetto al periodo precedente"
          }
        >
          {badgeText}
        </span>
      </div>

      <div>
        <p className="text-[32px] font-semibold tracking-tight leading-none">
          {formatCurrency(value)}
        </p>
        <p className="mt-2 text-[12px] text-[color:var(--color-muted-foreground)]">
          rispetto al periodo precedente
        </p>
      </div>
    </div>
  );
}
