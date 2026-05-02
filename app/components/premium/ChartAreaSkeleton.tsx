"use client";

import SkeletonGlow from "./SkeletonGlow";

type Props = {
  className?: string;
  /** Altezza area grafico (Tailwind class). */
  heightClass?: string;
};

export default function ChartAreaSkeleton({
  className = "",
  heightClass = "h-80",
}: Props) {
  return (
    <div className={["mt-6 space-y-3", className].filter(Boolean).join(" ")}>
      <div className="flex justify-between gap-2">
        <SkeletonGlow className="h-3 w-24 rounded-md" />
        <SkeletonGlow className="h-3 w-16 rounded-md" />
      </div>
      <SkeletonGlow className={`w-full rounded-xl ${heightClass}`} />
    </div>
  );
}
