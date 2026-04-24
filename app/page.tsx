import { Suspense } from "react";
import PageHeader from "./components/PageHeader";
import DashboardClient from "./components/DashboardClient";
import { MOCK_ACCOUNTS, MOCK_TRANSACTIONS } from "@/lib/mock-data";
import {
  avatarUrlFromUser,
  greetingFirstName,
  initialsFromUser,
} from "@/lib/auth-display";
import {
  getLatestAccountLastSyncIso,
  getSessionUser,
} from "@/lib/supabase/server-session";
import { getDefaultMonthRangeIso } from "@/lib/default-month-range";

export default async function DashboardPage() {
  const defaultRangeIso = getDefaultMonthRangeIso();

  const user = await getSessionUser();
  const firstName = greetingFirstName(user);
  const avatarInitials = initialsFromUser(user);
  const lastSync = await getLatestAccountLastSyncIso();

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 md:px-10 py-6 md:py-10 space-y-8">
      <PageHeader
        showTimeGreeting={false}
        title={`Ciao, ${firstName}`}
        subtitle="Ecco il quadro della tua famiglia — periodo e totali sono nelle card qui sotto."
        avatarInitials={avatarInitials}
        avatarUrl={avatarUrlFromUser(user)}
        lastSyncAtIso={lastSync}
      />

      {/* Suspense boundary richiesto da Next perché DashboardClient legge
          `useSearchParams()` per gestire il redirect da /api/callback. */}
      <Suspense fallback={null}>
        <DashboardClient
          defaultRangeIso={defaultRangeIso}
          fallback={MOCK_TRANSACTIONS}
          accountsFallback={MOCK_ACCOUNTS}
        />
      </Suspense>
    </div>
  );
}
