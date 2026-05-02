"use client";

type Props = {
  className?: string;
  /** Quando true, niente shimmer (riduced motion). */
  static?: boolean;
};

/**
 * Blocco placeholder con bagliore che scorre (stile “premium loading”).
 */
export default function SkeletonGlow({ className = "", static: noAnim }: Props) {
  return (
    <div
      className={[
        "relative isolate overflow-hidden rounded-lg bg-[color:var(--color-surface-muted)]/55",
        className,
      ].join(" ")}
    >
      {!noAnim ? (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden opacity-90 skeleton-shimmer-bar"
          aria-hidden
        />
      ) : null}
    </div>
  );
}
