"use client";

import { useEffect } from "react";

/**
 * Tells the stylesheet whether the page has been scrolled.
 *
 * The nav sits over the hero photograph with no background of its own, which
 * is right while the photograph is behind it and wrong the moment the cream
 * section arrives — cream text on cream. So past the fold it takes on a
 * forest bar, and that needs one bit of state the server cannot know.
 *
 * It is an attribute on <html> rather than React state because the nav is a
 * server component: keeping the flag in the DOM lets plain CSS do the work
 * and keeps the whole header off the client bundle.
 *
 * Nothing here is load-bearing. Without JavaScript the nav stays transparent
 * and every link still works; it is appearance, not function, which is why it
 * is safe to leave to an effect that may never run.
 */
export function NavChrome() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      // Just past the nav's own height: far enough that the bar does not
      // flicker in and out while someone nudges the page.
      root.dataset.scrolled = window.scrollY > 72 ? "true" : "false";
    };

    const onScroll = () => {
      // Scroll fires far more often than the screen repaints, and this only
      // ever changes a class.
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
      delete root.dataset.scrolled;
    };
  }, []);

  return null;
}
