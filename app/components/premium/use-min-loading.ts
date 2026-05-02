"use client";

import { useEffect, useRef, useState } from "react";

/** Durata minima consigliata per placeholder (skeleton) visibile. */
export const MIN_LOADING_SKELETON_MS = 300;

/**
 * Replica `loading` ma resta true almeno `minMs` dall’istante in cui è passato
 * a true, così skeleton/spinner non spariscono subito su fetch velocissimi.
 */
export function useMinLoading(loading: boolean, minMs = MIN_LOADING_SKELETON_MS): boolean {
  const [display, setDisplay] = useState(loading);
  const phaseStartRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      phaseStartRef.current = Date.now();
      setDisplay(true);
      return;
    }

    const t0 = phaseStartRef.current;
    if (t0 === null) {
      setDisplay(false);
      return;
    }

    const elapsed = Date.now() - t0;
    const remaining = Math.max(0, minMs - elapsed);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      phaseStartRef.current = null;
      setDisplay(false);
    }, remaining);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [loading, minMs]);

  return display;
}
