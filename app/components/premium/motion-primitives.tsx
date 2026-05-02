"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

const itemFadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const itemFadeUpReduced = {
  hidden: { opacity: 1, y: 0 },
  show: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.04,
    },
  },
};

const staggerContainerReduced = {
  hidden: {},
  show: { transition: { staggerChildren: 0, delayChildren: 0 } },
};

export function FadeUpStagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={reduce ? staggerContainerReduced : staggerContainer}
      initial={reduce ? "show" : "hidden"}
      animate="show"
    >
      {children}
    </motion.div>
  );
}

export function FadeUpChild({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={reduce ? itemFadeUpReduced : itemFadeUp}
    >
      {children}
    </motion.div>
  );
}
