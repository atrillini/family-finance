import PageHeader from "../components/PageHeader";
import { Sparkles, KeyRound, Bell } from "lucide-react";
import ProfileNameSettings from "../components/ProfileNameSettings";
import ProjectUsersList from "../components/ProjectUsersList";
import { getSessionUser } from "@/lib/supabase/server-session";

export default async function ImpostazioniPage() {
  const user = await getSessionUser();
  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const initialFullName =
    typeof meta?.full_name === "string" ? meta.full_name : "";

  return (
    <div className="px-6 md:px-10 py-8 md:py-10 space-y-8 max-w-[900px]">
      <PageHeader
        title="Impostazioni"
        subtitle="Gestisci il tuo profilo e le integrazioni di FamilyFinance AI."
      />

      <ProfileNameSettings
        initialFullName={initialFullName}
        email={user?.email ?? ""}
      />

      <ProjectUsersList />

      <SettingsRow
        icon={<Bell className="h-[18px] w-[18px]" />}
        title="Notifiche"
        description="Avvisi quando superi un budget o ricevi un accredito."
        actionLabel="Configura"
      />

      <div className="card-surface p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0a84ff] to-[#5e5ce6] text-white">
            <Sparkles className="h-[18px] w-[18px]" strokeWidth={2.5} />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold">Integrazione Gemini AI</p>
            <p className="mt-0.5 text-[13px] text-[color:var(--color-muted-foreground)]">
              Abilita la categorizzazione automatica delle transazioni
              impostando la variabile d&apos;ambiente{" "}
              <code className="rounded-md bg-[color:var(--color-surface-muted)] px-1.5 py-0.5 text-[12px] font-mono">
                GEMINI_API_KEY
              </code>{" "}
              nel file <code className="font-mono text-[12px]">.env.local</code>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-muted)]/50 p-4">
          <KeyRound className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
          <code className="font-mono text-[12.5px] text-[color:var(--color-muted-foreground)]">
            GEMINI_API_KEY=la-tua-chiave
          </code>
        </div>
      </div>
    </div>
  );
}

function SettingsRow({
  icon,
  title,
  description,
  actionLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
}) {
  return (
    <div className="card-surface flex items-center gap-4 p-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-surface-muted)] text-[color:var(--color-foreground)]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14.5px] font-semibold">{title}</p>
        <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
          {description}
        </p>
      </div>
      <button
        type="button"
        className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-[13px] font-medium transition-colors hover:bg-[color:var(--color-surface-muted)]"
      >
        {actionLabel}
      </button>
    </div>
  );
}
