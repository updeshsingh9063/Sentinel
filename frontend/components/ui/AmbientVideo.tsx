"use client";

import { useEffect, useRef } from "react";

/**
 * A silent background clip that sits beside copy.
 *
 * It carries no information, so it is decorative: aria-hidden, no controls, no
 * audio track expected. The still image stays as the poster, which means the
 * first paint is a photograph rather than a black rectangle, and anyone whose
 * browser blocks autoplay simply keeps that photograph.
 *
 * There is deliberately no `autoplay` attribute. Playback starts from script
 * instead, so `prefers-reduced-motion` is honoured before a single frame
 * moves — vestibular disorders are common in this audience, and a clip that
 * starts and then stops is worse than one that never starts. Without
 * JavaScript the poster frame is what you get, which is the correct fallback.
 */
export function AmbientVideo({
  src,
  poster,
  objectPosition = "50% 50%",
  className,
}: {
  src: string;
  poster?: string;
  objectPosition?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (mq.matches) {
        v.pause();
        v.currentTime = 0;
      } else {
        // Autoplay can still be refused (low power mode, a data saver). The
        // poster stays up and nothing breaks.
        void v.play().catch(() => {});
      }
    };

    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <video
      ref={ref}
      className={className}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      style={{ objectFit: "cover", objectPosition }}
    >
      <source src={src} type="video/mp4" />
    </video>
  );
}
