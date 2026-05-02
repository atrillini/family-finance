"use client";

import SkeletonGlow from "./SkeletonGlow";

/**
 * Sagoma della tabella transazioni durante il fetch iniziale.
 */
export default function TransactionsTableSkeleton() {
  return (
    <section className="card-surface overflow-hidden rounded-2xl">
      <div className="flex flex-col gap-3 border-b border-[color:var(--color-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 md:px-6">
        <div className="space-y-2">
          <SkeletonGlow className="h-5 w-44 rounded-md" />
          <SkeletonGlow className="h-3 w-56 max-w-full rounded-md" />
        </div>
        <SkeletonGlow className="h-9 w-full max-w-[220px] rounded-full sm:shrink-0" />
      </div>
      <div className="divide-y divide-[color:var(--color-border)]">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-4 sm:px-4 md:px-6"
          >
            <SkeletonGlow className="hidden h-10 w-10 shrink-0 rounded-xl sm:block" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonGlow className="h-4 w-[min(72%,280px)] rounded-md" />
              <SkeletonGlow className="h-3 w-32 rounded-md" />
            </div>
            <SkeletonGlow className="h-4 w-24 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </section>
  );
}
