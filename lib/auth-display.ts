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

/**
 * URL avatar da OAuth / metadata Supabase (solo HTTPS).
 */
export function avatarUrlFromUser(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const raw =
    (typeof meta?.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta?.picture === "string" && meta.picture) ||
    "";
  const u = raw.trim();
  if (u.startsWith("https://")) return u;
  return null;
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
