import PageHeader from "../components/PageHeader";
import { formatCurrency } from "@/lib/mock-data";
import { avatarUrlFromUser, initialsFromUser } from "@/lib/auth-display";
import {
  getLatestAccountLastSyncIso,
  getSessionUser,
} from "@/lib/supabase/server-session";

type BudgetItem = {
  category: string;
  spent: number;
  limit: number;
};

const BUDGETS: BudgetItem[] = [
  { category: "Alimentari", spent: 420, limit: 600 },
  { category: "Ristoranti", spent: 185, limit: 200 },
  { category: "Trasporti", spent: 140, limit: 250 },
  { category: "Bollette", spent: 240, limit: 300 },
  { category: "Svago", spent: 80, limit: 150 },
  { category: "Salute", spent: 65, limit: 200 },
];

export default async function BudgetPage() {
  const user = await getSessionUser();
  const lastSync = await getLatestAccountLastSyncIso();

  return (
    <div className="px-6 md:px-10 py-8 md:py-10 space-y-8 max-w-[1400px]">
      <PageHeader
        title="Budget"
        subtitle="Tieni sotto controllo le spese per categoria e rispetta i tuoi obiettivi."
        avatarInitials={initialsFromUser(user)}
        avatarUrl={avatarUrlFromUser(user)}
        lastSyncAtIso={lastSync}
      />

      <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {BUDGETS.map((b) => {
          const pct = Math.min(100, Math.round((b.spent / b.limit) * 100));
          const isOver = pct >= 90;
          return (
            <div key={b.category} className="card-surface p-6">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-semibold">{b.category}</p>
                <span
                  className={[
                    "text-[12px] font-medium rounded-full px-2 py-1",
                    isOver
                      ? "bg-[color:var(--color-expense)]/12 text-[color:var(--color-expense)]"
                      : "bg-[color:var(--color-surface-muted)] text-[color:var(--color-muted-foreground)]",
                  ].join(" ")}
                >
                  {pct}%
                </span>
              </div>

              <p className="mt-2 text-[22px] font-semibold tracking-tight tabular-nums">
                {formatCurrency(b.spent)}
                <span className="text-[14px] font-normal text-[color:var(--color-muted-foreground)]">
                  {" "}
                  / {formatCurrency(b.limit)}
                </span>
              </p>

              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
                <div
                  className={[
                    "h-full rounded-full transition-all",
                    isOver
                      ? "bg-[color:var(--color-expense)]"
                      : "bg-[color:var(--color-accent)]",
                  ].join(" ")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
