import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import type { Database } from "../supabase";

async function createServerSupabaseForSession() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, _headers) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Route Handlers / SC: set cookie può fallire fuori dal contesto mutabile
        }
      },
    },
  });
}

export async function getSessionUser(): Promise<User | null> {
  const supabase = await createServerSupabaseForSession();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

/** Timestamp ISO più recente tra i conti dell'utente collegato (sync banche). */
export async function getLatestAccountLastSyncIso(): Promise<string | null> {
  const supabase = await createServerSupabaseForSession();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("accounts")
    .select("last_sync_at")
    .eq("user_id", user.id);

  if (error || !data?.length) return null;

  let max: string | null = null;
  for (const row of data) {
    const t = row.last_sync_at;
    if (!t) continue;
    if (!max || new Date(t).getTime() > new Date(max).getTime()) max = t;
  }
  return max;
}

