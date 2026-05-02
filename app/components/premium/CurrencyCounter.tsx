"use client";

import { animate, useReducedMotion } from "framer-motion";
import { useLayoutEffect, useRef } from "react";
import { formatCurrency } from "@/lib/mock-data";

type Props = {
  value: number;
  className?: string;
};

/**
 * Saldo / importo che si anima verso il valore finale (evita salti bruschi).
 * Aggiornamento via `textContent` per non usare setState in effect.
 * Rispetta `prefers-reduced-motion`.
 */
export default function CurrencyCounter({ value, className }: Props) {
  const reduce = useReducedMotion();
  const spanRef = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = spanRef.current;
    if (!el) return;

    if (reduce) {
      el.textContent = formatCurrency(value);
      prev.current = value;
      return;
    }

    if (prev.current === null) {
      el.textContent = formatCurrency(value);
      prev.current = value;
      return;
    }

    const from = prev.current;
    prev.current = value;
    const controls = animate(from, value, {
      duration: 0.55,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => {
        el.textContent = formatCurrency(latest as number);
      },
    });

    return () => controls.stop();
  }, [value, reduce]);

  return (
    <span ref={spanRef} className={className} suppressHydrationWarning>
      {formatCurrency(value)}
    </span>
  );
}
