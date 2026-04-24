import PageHeader from "../components/PageHeader";
import GraficiClient from "../components/GraficiClient";
import { MOCK_TRANSACTIONS } from "@/lib/mock-data";
import { getDefaultMonthRangeIso } from "@/lib/default-month-range";
import { initialsFromUser } from "@/lib/auth-display";
import { getSessionUser } from "@/lib/supabase/server-session";

export default async function GraficiPage() {
  const defaultRangeIso = getDefaultMonthRangeIso();
  const user = await getSessionUser();
  const avatarInitials = initialsFromUser(user);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 md:px-10 py-6 md:py-10 space-y-8">
      <PageHeader
        title="Grafici"
        subtitle="Andamento delle uscite e confronto con il periodo precedente (stessa lunghezza in giorni)."
        avatarInitials={avatarInitials}
      />

      <GraficiClient
        defaultRangeIso={defaultRangeIso}
        fallback={MOCK_TRANSACTIONS}
      />
    </div>
  );
}
