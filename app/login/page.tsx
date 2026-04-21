"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { isPublicRegistrationOpen } from "@/lib/registration-policy";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";
  const reason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signErr) throw signErr;
      router.push(nextPath.startsWith("/") ? nextPath : "/");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Accesso non riuscito."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 py-12 bg-[color:var(--color-background)]">
      <div className="w-full max-w-[400px] card-surface p-8 md:p-10 space-y-8">
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0a84ff] to-[#5e5ce6] text-white shadow-sm">
              <Sparkles className="h-5 w-5" strokeWidth={2.5} />
            </div>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Accedi a FamilyFinance
            </h1>
            <p className="mt-2 text-[13px] text-[color:var(--color-muted-foreground)] leading-snug">
              Usa email e password del tuo account Supabase.
            </p>
          </div>
        </div>

        {reason === "session" ? (
          <p className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-muted)] px-4 py-3 text-[13px] text-[color:var(--color-muted-foreground)]">
            Sessione scaduta o non valida dopo il consenso bancario.
            Effettua di nuovo il login per completare il collegamento del conto.
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-5">
          {error ? (
            <p className="text-[13px] text-[color:var(--color-expense)]">
              {error}
            </p>
          ) : null}

          <div className="space-y-2">
            <label
              htmlFor="email"
              className="block text-[12px] font-medium text-[color:var(--color-muted-foreground)]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-[15px] outline-none transition-colors focus:border-[color:var(--color-accent)]"
              placeholder="nome@email.com"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="block text-[12px] font-medium text-[color:var(--color-muted-foreground)]"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-[15px] outline-none transition-colors focus:border-[color:var(--color-accent)]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--color-accent)] text-[15px] font-semibold text-white shadow-sm transition-opacity hover:opacity-92 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Accesso...
              </>
            ) : (
              "Accedi"
            )}
          </button>
        </form>

        {isPublicRegistrationOpen() ? (
          <p className="text-center text-[13px] text-[color:var(--color-muted-foreground)]">
            Non hai un account?{" "}
            <Link
              href="/register"
              className="font-semibold text-[color:var(--color-accent)] hover:underline"
            >
              Registrati
            </Link>
          </p>
        ) : (
          <p className="text-center text-[13px] text-[color:var(--color-muted-foreground)] leading-snug">
            Gli account sono creati dall&apos;amministratore. Se ti è stato
            assegnato un accesso, usa Accedi qui sopra.
          </p>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <LoginForm />
    </Suspense>
  );
}
