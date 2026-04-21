"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

type Props = {
  initialFullName: string;
  email: string;
};

export default function ProfileNameSettings({
  initialFullName,
  email,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialFullName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const supabase = getSupabaseClient();
      const trimmed = name.trim();
      const { error } = await supabase.auth.updateUser({
        data: { full_name: trimmed },
      });
      if (error) throw error;
      setMessage("Nome salvato.");
      router.refresh();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Impossibile salvare il nome."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card-surface p-6 space-y-4">
      <div>
        <p className="text-[14.5px] font-semibold">Profilo</p>
        <p className="mt-0.5 text-[13px] text-[color:var(--color-muted-foreground)]">
          Il nome viene usato nel saluto sulla dashboard e nelle iniziali.
        </p>
      </div>

      <div className="space-y-1">
        <label className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]">
          Email
        </label>
        <p className="text-[14px]">{email || "—"}</p>
      </div>

      <form onSubmit={onSave} className="space-y-3">
        <div className="space-y-1">
          <label
            htmlFor="full_name"
            className="text-[12px] font-medium text-[color:var(--color-muted-foreground)]"
          >
            Nome visualizzato
          </label>
          <input
            id="full_name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Come vuoi essere chiamato"
            className="h-10 w-full max-w-md rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-[14px] outline-none focus:border-[color:var(--color-accent)]"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-[color:var(--color-accent)] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
          >
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Salvataggio…
              </span>
            ) : (
              "Salva nome"
            )}
          </button>
          {message ? (
            <span className="text-[13px] text-[color:var(--color-muted-foreground)]">
              {message}
            </span>
          ) : null}
        </div>
      </form>
    </div>
  );
}
