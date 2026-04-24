import PageHeader from "../components/PageHeader";
import GraficiClient from "../components/GraficiClient";
import { MOCK_TRANSACTIONS } from "@/lib/mock-data";
import { getDefaultMonthRangeIso } from "@/lib/default-month-range";
import { avatarUrlFromUser, initialsFromUser } from "@/lib/auth-display";
import {
  getLatestAccountLastSyncIso,
  getSessionUser,
} from "@/lib/supabase/server-session";

export default async function GraficiPage() {
  const defaultRangeIso = getDefaultMonthRangeIso();
  const user = await getSessionUser();
  const avatarInitials = initialsFromUser(user);
  const lastSync = await getLatestAccountLastSyncIso();

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 md:px-10 py-6 md:py-10 space-y-8">
      <PageHeader
        title="Grafici"
        subtitle="Spesa cumulativa, burn rate settimanale, Sankey entrate/uscite e insight su aggregati."
        avatarInitials={avatarInitials}
        avatarUrl={avatarUrlFromUser(user)}
        lastSyncAtIso={lastSync}
      />

      <GraficiClient
        defaultRangeIso={defaultRangeIso}
        fallback={MOCK_TRANSACTIONS}
      />
    </div>
  );
}
