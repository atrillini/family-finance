import PageHeader from "../components/PageHeader";
import TransactionsClient from "../components/TransactionsClient";
import { MOCK_ACCOUNTS, MOCK_TRANSACTIONS } from "@/lib/mock-data";
import { getDefaultMonthRangeIso } from "@/lib/default-month-range";

export default function TransazioniPage() {
  const defaultRangeIso = getDefaultMonthRangeIso();

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 md:px-10 py-6 md:py-10 space-y-8">
      <PageHeader
        title="Transazioni"
        subtitle="Tutte le entrate e le uscite della famiglia, in un colpo d'occhio."
      />

      <TransactionsClient
        defaultRangeIso={defaultRangeIso}
        fallback={MOCK_TRANSACTIONS}
        accountsFallback={MOCK_ACCOUNTS}
      />
    </div>
  );
}
