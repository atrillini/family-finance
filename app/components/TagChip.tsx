"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import { getTagChipStyles } from "@/lib/tag-colors";

type TagChipProps = {
  tag: string;
  /** Dimensione tipografica coerente con contesto tabella / modal */
  size?: "sm" | "md";
  className?: string;
  title?: string;
  onClick?: (e: MouseEvent<HTMLSpanElement>) => void;
};

const SIZE_CLASS: Record<NonNullable<TagChipProps["size"]>, string> = {
  sm: "px-1.5 py-0.5 text-[10.5px]",
  md: "px-2 py-0.5 text-[11px]",
};

/**
 * Pill colorata deterministicamente per stringa tag (gradiente pastello).
 */
export default function TagChip({
  tag,
  size = "md",
  className = "",
  title,
  onClick,
}: TagChipProps) {
  const label = tag.trim();
  if (!label) return null;
  const { background, color } = getTagChipStyles(label);

  const interactive = Boolean(onClick);

  return (
    <span
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={title ?? label}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e: KeyboardEvent<HTMLSpanElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.currentTarget.click();
              }
            }
          : undefined
      }
      style={{ background, color }}
      className={[
        "inline-flex max-w-[14rem] shrink-0 items-center truncate rounded-full font-medium shadow-sm ring-1 ring-black/[0.06]",
        SIZE_CLASS[size],
        interactive
          ? "cursor-pointer transition hover:brightness-[1.03] hover:ring-[color:var(--color-accent)]/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
          : "",
        className,
      ].join(" ")}
    >
      {label}
    </span>
  );
}
