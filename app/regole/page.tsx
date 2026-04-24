import PageHeader from "../components/PageHeader";
import RulesClient from "../components/RulesClient";
import { avatarUrlFromUser, initialsFromUser } from "@/lib/auth-display";
import {
  getLatestAccountLastSyncIso,
  getSessionUser,
} from "@/lib/supabase/server-session";

export const dynamic = "force-dynamic";

export default async function RegolePage() {
  const user = await getSessionUser();
  const lastSync = await getLatestAccountLastSyncIso();

  return (
    <div className="px-6 md:px-10 py-8 md:py-10 space-y-8 max-w-[1100px]">
      <PageHeader
        title="Regole di categorizzazione"
        subtitle="Insegna all'IA come categorizzare le tue transazioni ricorrenti. Le regole vengono applicate sia nella sincronizzazione sia quando clicchi il pulsante Gemini su una riga."
        avatarInitials={initialsFromUser(user)}
        avatarUrl={avatarUrlFromUser(user)}
        lastSyncAtIso={lastSync}
      />
      <RulesClient />
    </div>
  );
}
