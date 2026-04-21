import { Suspense } from "react";
import PageHeader from "./components/PageHeader";
import DashboardClient from "./components/DashboardClient";
import { MOCK_ACCOUNTS, MOCK_TRANSACTIONS } from "@/lib/mock-data";
import { greetingFirstName, initialsFromUser } from "@/lib/auth-display";
import { getSessionUser } from "@/lib/supabase/server-session";

export default async function DashboardPage() {
  const monthLabel = new Intl.DateTimeFormat("it-IT", {
    month: "long",
    year: "numeric",
  }).format(new Date());
  const monthLabelCap =
    monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  const user = await getSessionUser();
  const firstName = greetingFirstName(user);
  const avatarInitials = initialsFromUser(user);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 md:px-10 py-6 md:py-10 space-y-8">
      <PageHeader
        title={`Ciao, ${firstName}`}
        subtitle={`Ecco il quadro della tua famiglia per ${monthLabelCap}.`}
        avatarInitials={avatarInitials}
      />

      {/* Suspense boundary richiesto da Next perché DashboardClient legge
          `useSearchParams()` per gestire il redirect da /api/callback. */}
      <Suspense fallback={null}>
        <DashboardClient
          monthLabel={monthLabelCap}
          fallback={MOCK_TRANSACTIONS}
          accountsFallback={MOCK_ACCOUNTS}
        />
      </Suspense>
    </div>
  );
}
