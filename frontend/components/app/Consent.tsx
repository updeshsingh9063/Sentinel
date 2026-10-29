"use client";

import { useState } from "react";

import type { FamilyConsent } from "@/lib/family";

/**
 * Consent switches for family sharing.
 *
 * Consent is a requirement in the brief, not a setting, so it is on the
 * family's own page where they can change it rather than buried in an admin
 * screen they will never open. Turning one off has to be as easy as turning it
 * on; anything else is not consent.
 *
 * Local state for the demo. The real control is the database: a family member
 * holds no policy on vitals, notes, cues or risk scores, so revoking here
 * changes what is *sent*, while the schema is what makes the rest
 * unreachable.
 */
export function Consent({ items }: { items: FamilyConsent[] }) {
  const [granted, setGranted] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((c) => [c.scope, c.granted])),
  );

  return (
    <ul className="consent">
      {items.map((c) => {
        const on = granted[c.scope];
        return (
          <li key={c.scope}>
            <span className="consent__text">
              <span className="consent__label" id={`consent-${c.scope}`}>
                {c.label}
              </span>
              <small>{c.detail}</small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby={`consent-${c.scope}`}
              className="consent__switch"
              onClick={() => setGranted({ ...granted, [c.scope]: !on })}
            >
              <i aria-hidden="true" />
              <span>{on ? "On" : "Off"}</span>
            </button>
          </li>
        );
      })}

      <style>{`
        .consent { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
        .consent li {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: var(--s-5);
          padding-bottom: var(--s-4); border-bottom: 1px solid var(--line);
        }
        .consent li:last-child { border-bottom: 0; padding-bottom: 0; }
        .consent__text { display: grid; gap: var(--s-1); }
        .consent__label { font-size: var(--fs-sm); font-weight: 600; }
        .consent__text small { font-size: var(--fs-xs); color: var(--ink-3); line-height: 1.55; }
        .consent__switch {
          display: inline-flex; align-items: center; gap: var(--s-2);
          font: inherit; font-size: var(--fs-xs); font-weight: 600;
          color: var(--ink-2);
          background: none; border: 0; padding: 0; cursor: pointer;
          flex: none;
        }
        .consent__switch i {
          width: 40px; height: 23px; border-radius: var(--radius-pill);
          background: var(--line-2); position: relative; display: block;
          transition: background var(--dur) var(--ease);
        }
        .consent__switch i::after {
          content: ""; position: absolute; top: 3px; left: 3px;
          width: 17px; height: 17px; border-radius: 50%;
          background: var(--white);
          transition: transform var(--dur) var(--ease);
        }
        .consent__switch[aria-checked="true"] i { background: var(--forest); }
        .consent__switch[aria-checked="true"] i::after { transform: translateX(17px); }
        .consent__switch:focus-visible { outline: 2px solid var(--forest); outline-offset: 3px; border-radius: var(--radius-sm); }
      `}</style>
    </ul>
  );
}
