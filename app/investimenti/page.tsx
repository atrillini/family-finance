import PageHeader from "../components/PageHeader";
import InvestimentiClient from "../components/InvestimentiClient";
import { avatarUrlFromUser, initialsFromUser } from "@/lib/auth-display";
import {
  getLatestAccountLastSyncIso,
  getSessionUser,
} from "@/lib/supabase/server-session";

export default async function InvestimentiPage() {
  const user = await getSessionUser();
  const lastSync = await getLatestAccountLastSyncIso();

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 md:px-10 py-6 md:py-10 space-y-8">
      <PageHeader
        title="Investimenti"
        subtitle="Patrimonio stimato (liquidità + posizioni manuali), scenario di proiezione e commento narrativo sui numeri già calcolati dall’app."
        avatarInitials={initialsFromUser(user)}
        avatarUrl={avatarUrlFromUser(user)}
        lastSyncAtIso={lastSync}
      />

      <InvestimentiClient />
    </div>
  );
}
