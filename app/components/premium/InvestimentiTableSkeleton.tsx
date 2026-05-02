"use client";

import SkeletonGlow from "./SkeletonGlow";

/** Corpo tabella posizioni (l’header resta nel parent). */
export default function InvestimentiTableSkeleton() {
  return (
    <div className="divide-y divide-[color:var(--color-border)]">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:flex-nowrap"
        >
          <SkeletonGlow className="h-4 w-[min(200px,42%)] rounded-md" />
          <SkeletonGlow className="h-4 w-28 shrink-0 rounded-md" />
          <SkeletonGlow className="h-4 w-14 shrink-0 rounded-md" />
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            <SkeletonGlow className="h-4 w-20 rounded-md" />
            <SkeletonGlow className="h-4 w-16 rounded-md" />
            <SkeletonGlow className="h-4 w-24 rounded-md" />
            <SkeletonGlow className="h-8 w-28 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
