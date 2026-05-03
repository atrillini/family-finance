import PageHeader from "../components/PageHeader";
import AnalisiTagClient from "../components/AnalisiTagClient";
import { MOCK_TRANSACTIONS } from "@/lib/mock-data";
import { getDefaultMonthRangeIso } from "@/lib/default-month-range";
import { avatarUrlFromUser, initialsFromUser } from "@/lib/auth-display";
import {
  getLatestAccountLastSyncIso,
  getSessionUser,
} from "@/lib/supabase/server-session";

export default async function AnalisiTagPage() {
  const defaultRangeIso = getDefaultMonthRangeIso();
  const user = await getSessionUser();
  const avatarInitials = initialsFromUser(user);
  const lastSync = await getLatestAccountLastSyncIso();

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-8 px-4 py-6 sm:px-6 md:px-10 md:py-10">
      <PageHeader
        title="Analisi tag"
        subtitle="Confronta entrate, uscite e netto per un insieme di tag tra due periodi (stessa logica del Sankey per-tag: quota uguale se una transazione ha più tag selezionati)."
        avatarInitials={avatarInitials}
        avatarUrl={avatarUrlFromUser(user)}
        lastSyncAtIso={lastSync}
      />

      <AnalisiTagClient
        defaultRangeIso={defaultRangeIso}
        fallback={MOCK_TRANSACTIONS}
      />
    </div>
  );
}
