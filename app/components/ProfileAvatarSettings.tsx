"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

const BUCKET = "profile-avatars";
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

type Props = {
  userId: string | null;
  /** URL corrente (metadata), per anteprima. */
  initialAvatarUrl: string | null;
  initials: string;
};

function extFromMime(mime: string): string | null {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return null;
}

export default function ProfileAvatarSettings({
  userId,
  initialAvatarUrl,
  initials,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(initialAvatarUrl);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !userId) return;
    setMessage(null);

    if (file.size > MAX_BYTES) {
      setMessage("File troppo grande (max 2 MB).");
      return;
    }
    const ext = extFromMime(file.type);
    if (!ext) {
      setMessage("Usa JPEG, PNG, WebP o GIF.");
      return;
    }

    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const path = `${userId}/avatar.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          upsert: true,
          contentType: file.type,
          cacheControl: "3600",
        });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const base = pub.publicUrl;
      const bust = `${base}?v=${Date.now()}`;
      const { error: authErr } = await supabase.auth.updateUser({
        data: { avatar_url: bust },
      });
      if (authErr) throw authErr;

      setPreview(bust);
      setMessage("Avatar aggiornato.");
      router.refresh();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Caricamento non riuscito."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!userId) {
    return null;
  }

  const showImg =
    typeof preview === "string" && preview.startsWith("https://");

  return (
    <div className="card-surface p-6 space-y-4">
      <div>
        <p className="text-[14.5px] font-semibold">Foto profilo</p>
        <p className="mt-0.5 text-[13px] text-[color:var(--color-muted-foreground)]">
          Se l&apos;immagine da Google non compare nell&apos;header, caricala
          qui: viene salvata su Supabase Storage e collegata al profilo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt=""
            width={72}
            height={72}
            referrerPolicy="no-referrer"
            className="h-[72px] w-[72px] rounded-full border border-[color:var(--color-border)] object-cover"
          />
        ) : (
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-gradient-to-br from-[#5e5ce6] to-[#0a84ff] text-[18px] font-semibold text-white">
            {initials.slice(0, 3)}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={onPickFile}
            disabled={busy}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-[13px] font-semibold text-[color:var(--color-foreground)] disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-4 w-4" aria-hidden />
            )}
            {busy ? "Caricamento…" : "Carica immagine"}
          </button>
          {message ? (
            <p className="text-[13px] text-[color:var(--color-muted-foreground)]">
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
