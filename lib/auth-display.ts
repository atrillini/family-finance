import type { User } from "@supabase/supabase-js";

/**
 * Nome corto per saluti (preferisce full_name / display_name nei metadata).
 */
export function greetingFirstName(user: User | null): string {
  if (!user) return "tu";
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const full =
    typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  const display =
    typeof meta?.display_name === "string" ? meta.display_name.trim() : "";
  const chosen = full || display;
  if (chosen) {
    const first = chosen.split(/\s+/).filter(Boolean)[0];
    return first ? capitalizeWord(first) : capitalizeWord(chosen);
  }
  const local = user.email?.split("@")[0]?.trim();
  return local ? capitalizeWord(local) : "tu";
}

function pickAvatarRawFromMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta) return "";
  const a =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    (typeof meta.image === "string" && meta.image) ||
    "";
  return String(a).trim();
}

function pickAvatarRawFromIdentities(user: User): string {
  for (const id of user.identities ?? []) {
    const data = id.identity_data as Record<string, unknown> | undefined;
    const fromId = pickAvatarRawFromMeta(data);
    if (fromId) return fromId;
  }
  return "";
}

/**
 * Normalizza URL avatar (OAuth / metadata / identities Supabase).
 * Accetta solo HTTPS; per alcuni provider prova upgrade da HTTP.
 */
export function normalizeAvatarUrl(raw: string): string | null {
  let u = raw.trim();
  if (!u) return null;
  if (u.startsWith("//")) u = `https:${u}`;
  if (u.startsWith("http://")) {
    try {
      const host = new URL(u).hostname.toLowerCase();
      const upgrade =
        host.endsWith("googleusercontent.com") ||
        host.endsWith("gravatar.com") ||
        host.endsWith("githubusercontent.com") ||
        host.endsWith("github.com") ||
        host.endsWith("supabase.co") ||
        host.endsWith("licdn.com");
      if (upgrade) u = `https://${u.slice("http://".length)}`;
    } catch {
      /* ignore */
    }
  }
  if (u.startsWith("https://")) return u;
  return null;
}

/**
 * URL avatar da OAuth / metadata / identities Supabase (preferisce HTTPS).
 */
export function avatarUrlFromUser(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const fromMeta = pickAvatarRawFromMeta(meta);
  const fromIdentities = fromMeta ? "" : pickAvatarRawFromIdentities(user);
  const raw = fromMeta || fromIdentities;
  return normalizeAvatarUrl(raw);
}

export function initialsFromUser(user: User | null): string {
  if (!user) return "?";
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const full =
    typeof meta?.full_name === "string"
      ? meta.full_name.trim()
      : typeof meta?.display_name === "string"
        ? String(meta.display_name).trim()
        : "";
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map((w) => w[0]?.toUpperCase()).join("") || "?";
  }
  const email = user.email ?? "?";
  return email.slice(0, 2).toUpperCase();
}

function capitalizeWord(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
