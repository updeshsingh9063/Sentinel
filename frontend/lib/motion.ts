/**
 * Shared motion language.
 *
 * One file so the whole app moves the same way. Two rules behind these values:
 *
 *  1. Entrances decelerate, interactions are short. EASE_OUT is a strong
 *     deceleration curve — things arrive and settle rather than sliding
 *     linearly into place. Interactions stay under 220ms; past that a UI reads
 *     as laggy rather than premium.
 *
 *  2. Motion is directional and square. Reveals translate and clip along
 *     straight edges only — no scaling from a point, no rotation, no circular
 *     wipes — because the design system forbids curves and a radial reveal
 *     would contradict the shape law more loudly than a rounded corner.
 */

import type { Transition, Variants } from "motion/react";

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IO = [0.65, 0, 0.35, 1] as const;
export const EASE_IN = [0.7, 0, 0.84, 0] as const;

export const DUR = {
  fast: 0.14,
  base: 0.22,
  slow: 0.64,
  reveal: 0.9,
} as const;

export const transition: Transition = {
  duration: DUR.slow,
  ease: EASE_OUT,
};

/** Standard section entrance: rise and fade, triggered once on scroll. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition },
};

/** Same, but for items inside a staggered parent. */
export const riseItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE_OUT } },
};

/**
 * Stagger container. `delayChildren` buys a beat so the group reads as one
 * gesture rather than a queue of unrelated arrivals.
 */
export function stagger(each = 0.07, delay = 0.05): Variants {
  return {
    hidden: {},
    show: {
      transition: { staggerChildren: each, delayChildren: delay },
    },
  };
}

/**
 * Clip reveal along one straight edge. Used for images and panels.
 * `inset()` keeps the edge hard, which a scale or opacity fade would not.
 */
export const clipUp: Variants = {
  hidden: { clipPath: "inset(100% 0 0 0)" },
  show: {
    clipPath: "inset(0% 0 0 0)",
    transition: { duration: DUR.reveal, ease: EASE_OUT },
  },
};

export const clipLeft: Variants = {
  hidden: { clipPath: "inset(0 100% 0 0)" },
  show: {
    clipPath: "inset(0 0% 0 0)",
    transition: { duration: DUR.reveal, ease: EASE_OUT },
  },
};

/** A hairline drawing itself across the viewport. */
export const drawLine: Variants = {
  hidden: { scaleX: 0 },
  show: {
    scaleX: 1,
    transition: { duration: DUR.reveal, ease: EASE_IO },
  },
};

/**
 * Per-line display type reveal. Each line is masked by its own overflow box
 * and slides up from beneath — the effect that carries most of the "premium"
 * read on a hero.
 */
export const lineMask: Variants = {
  hidden: { y: "110%" },
  show: {
    y: "0%",
    transition: { duration: DUR.reveal, ease: EASE_OUT },
  },
};

/** Viewport defaults for `whileInView`. Fires slightly before full entry. */
export const inView = {
  once: true,
  margin: "-12% 0px -12% 0px",
} as const;
