"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Scroll entrance that never hides anything the reader can already see.
 *
 * Two rules, both learned the hard way:
 *
 *  1. The resting state is VISIBLE. Nothing is server-rendered at opacity 0
 *     waiting for an observer, so a crawler, a screenshot, a slow network or a
 *     failed bundle still gets a complete page.
 *
 *  2. On mount, an element already inside the viewport is never armed at all.
 *     Arming it would hide content the reader is looking at and hand its
 *     return to an IntersectionObserver — which, in a tall viewport where
 *     everything is "in view", is a race. That race blanked whole sections of
 *     this page in automated captures.
 *
 * So only content below the fold is armed, and only that content animates.
 * The CSS lives in [data-reveal] in design-system.css; there is no animation
 * library on this path.
 */
export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  className,
  style,
}: {
  children: ReactNode;
  as?: ElementType;
  /** Seconds, to stagger siblings. Keep under ~0.3s or it reads as a queue. */
  delay?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // With reduced motion we never hide anything in the first place.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Already on screen? Leave it alone.
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (rect.top < vh * 0.92 && rect.bottom > 0) return;

    el.dataset.armed = "true";

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          el.dataset.in = "true";
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0 },
    );
    io.observe(el);

    // Last resort. An unanimated section beats an invisible one.
    const fallback = window.setTimeout(() => {
      el.dataset.in = "true";
    }, 1200);

    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal=""
      className={className}
      style={
        delay
          ? ({ ...style, "--reveal-delay": `${delay}s` } as React.CSSProperties)
          : style
      }
    >
      {children}
    </Tag>
  );
}
