"use client";

import { useEffect, useState } from "react";

/**
 * Accessibility bar — contrast mode and text scaling.
 *
 * It stays visible rather than hiding behind a menu, because a control a
 * low-vision user has to hunt for is not a control. But it is chrome, so it is
 * quiet: right-aligned, small, one hairline, no boxes. The previous version
 * was a full-width strip of outlined buttons and was the first thing anyone
 * saw on the page.
 *
 * Two behaviours worth keeping:
 *  - Real <button>s with aria-pressed. The control this was modelled on puts
 *    role="button" on <li> elements, which looks keyboard-accessible and is
 *    not.
 *  - The choice persists to localStorage. Asking a low-vision user to re-set
 *    text size on every page load defeats the feature.
 *
 * Scaling is one line of CSS: :root[data-text-scale="150"] sets font-size to
 * 150%, and because every token is in rem the whole interface follows.
 *
 * On a narrow screen the group labels go visually-hidden rather than wrapping.
 * They used to wrap and push the 150% and 200% buttons off the edge, which
 * removed the feature exactly where it is needed most.
 */

type Contrast = "default" | "bw";
type Scale = "100" | "150" | "200";

const STORE_CONTRAST = "samarth.contrast";
const STORE_SCALE = "samarth.textScale";

export function A11yBar() {
  const [contrast, setContrast] = useState<Contrast>("default");
  const [scale, setScale] = useState<Scale>("100");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const c = localStorage.getItem(STORE_CONTRAST) as Contrast | null;
      const s = localStorage.getItem(STORE_SCALE) as Scale | null;
      if (c === "bw") setContrast(c);
      if (s === "150" || s === "200") setScale(s);
    } catch {
      // no stored preference available; defaults stand
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;

    if (contrast === "bw") root.setAttribute("data-contrast", "bw");
    else root.removeAttribute("data-contrast");

    if (scale === "100") root.removeAttribute("data-text-scale");
    else root.setAttribute("data-text-scale", scale);

    try {
      localStorage.setItem(STORE_CONTRAST, contrast);
      localStorage.setItem(STORE_SCALE, scale);
    } catch {
      // preference applies for this session only
    }
  }, [contrast, scale, ready]);

  return (
    <nav className="a11y" aria-label="Accessibility options">
      <div className="a11y__inner">
        <fieldset className="a11y__group">
          <legend className="visually-hidden">Contrast</legend>
          <span className="a11y__legend" aria-hidden="true">
            Contrast
          </span>
          {(
            [
              ["default", "Default"],
              ["bw", "High"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              className="a11y__btn"
              aria-pressed={contrast === value}
              onClick={() => setContrast(value)}
            >
              {text}
            </button>
          ))}
        </fieldset>

        <span className="a11y__sep" aria-hidden="true" />

        <fieldset className="a11y__group">
          <legend className="visually-hidden">Text size</legend>
          <span className="a11y__legend" aria-hidden="true">
            Text size
          </span>
          {(["100", "150", "200"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="a11y__btn"
              aria-pressed={scale === value}
              onClick={() => setScale(value)}
            >
              {value}%
            </button>
          ))}
        </fieldset>
      </div>

      <style>{`
        .a11y {
          position: fixed;
          top: 0; left: 0; right: 0;
          height: var(--a11y-h);
          z-index: var(--z-a11y);
          background: var(--ground);
          border-bottom: 1px solid var(--line);
        }
        .a11y__inner {
          max-width: var(--maxw);
          margin-inline: auto;
          padding-inline: var(--gutter);
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: var(--s-3);
          overflow-x: auto;
          white-space: nowrap;
          scrollbar-width: none;
        }
        .a11y__inner::-webkit-scrollbar { display: none; }
        .a11y__group {
          display: flex;
          align-items: center;
          gap: var(--s-1);
          border: 0; margin: 0; padding: 0;
          flex: none;
        }
        .a11y__legend {
          font-size: var(--fs-axis);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-3);
          margin-right: var(--s-2);
        }
        .a11y__sep { width: 1px; height: 1rem; background: var(--line); flex: none; }
        .a11y__btn {
          font: inherit;
          font-size: var(--fs-axis);
          font-family: var(--mono);
          letter-spacing: 0.04em;
          color: var(--ink-3);
          background: transparent;
          border: 0;
          padding: var(--s-1) var(--s-2);
          cursor: pointer;
          min-height: 1.75rem;
        }
        .a11y__btn:hover { color: var(--ink); }
        .a11y__btn[aria-pressed="true"] {
          color: var(--ink);
          box-shadow: inset 0 -1px 0 0 var(--ink);
        }
        /* Labels go before buttons do. They used to wrap and push the 150% and
           200% controls off the screen. */
        @media (max-width: 34rem) {
          .a11y__legend { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
          .a11y__inner { gap: var(--s-2); }
        }
      `}</style>
    </nav>
  );
}
