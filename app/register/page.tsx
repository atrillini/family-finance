"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error: signErr } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      });
      if (signErr) throw signErr;

      if (data.session) {
        router.push(nextPath.startsWith("/") ? nextPath : "/");
        router.refresh();
        return;
      }

      setInfo(
        "Controlla la posta: se la conferma email è attiva su Supabase, apri il link per attivare l'account."
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Registrazione non riuscita."
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
              Crea il tuo account
            </h1>
            <p className="mt-2 text-[13px] text-[color:var(--color-muted-foreground)] leading-snug">
              Registrazione tramite Supabase Auth (email e password).
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          {error ? (
            <p className="text-[13px] text-[color:var(--color-expense)]">
              {error}
            </p>
          ) : null}
          {info ? (
            <p className="text-[13px] text-[color:var(--color-muted-foreground)] leading-snug">
              {info}
            </p>
          ) : null}

          <div className="space-y-2">
            <label
              htmlFor="reg-email"
              className="block text-[12px] font-medium text-[color:var(--color-muted-foreground)]"
            >
              Email
            </label>
            <input
              id="reg-email"
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
              htmlFor="reg-password"
              className="block text-[12px] font-medium text-[color:var(--color-muted-foreground)]"
            >
              Password
            </label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 text-[15px] outline-none transition-colors focus:border-[color:var(--color-accent)]"
            />
            <p className="text-[11px] text-[color:var(--color-muted-foreground)]">
              Minimo 6 caratteri (requisito tipico Supabase).
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--color-accent)] text-[15px] font-semibold text-white shadow-sm transition-opacity hover:opacity-92 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creazione...
              </>
            ) : (
              "Registrati"
            )}
          </button>
        </form>

        <p className="text-center text-[13px] text-[color:var(--color-muted-foreground)]">
          Hai già un account?{" "}
          <Link
            href="/login"
            className="font-semibold text-[color:var(--color-accent)] hover:underline"
          >
            Accedi
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-[40vh]" />}>
      <RegisterForm />
    </Suspense>
  );
}
