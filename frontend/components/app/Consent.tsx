"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";
import type { FamilyConsent } from "@/lib/family";

/**
 * Consent switches for family sharing.
 *
 * Consent is a requirement in the brief, not a setting, so it is on the
 * family's own page where they can change it rather than buried in an admin
 * screen they will never open. Turning one off has to be as easy as turning it
 * on; anything else is not consent.
 *
 * IT WRITES. Until 2026-10-30 this held its answer in React state and saved
 * nothing — "local state for the demo", said the comment that used to be
 * here. A privacy control that silently does not save is worse than no
 * control at all: it tells somebody they have turned sharing off while the
 * system carries on exactly as before. Now that family notifications are
 * genuinely gated on these rows, the switch had to become the thing it
 * already looked like.
 *
 * The schema is still the real guarantee. A family member holds no policy on
 * vitals, notes, cues or risk scores, so revoking here changes what is
 * *sent*, while the schema is what makes the rest unreachable at all.
 *
 * IT SHOWS THE OLD ANSWER UNTIL THE WRITE LANDS. Flipping optimistically and
 * rolling back on failure would show somebody "Off" for a moment on the one
 * control where a moment of the wrong answer is the entire problem.
 */
export function Consent({ items, seniorId }: { items: FamilyConsent[]; seniorId: string }) {
  const [granted, setGranted] = useState<Record<string, boolean>>(
    Object.fromEntries(items.map((c) => [c.scope, c.granted])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function flip(scope: string, to: boolean) {
    setBusy(scope);
    setFailed(null);
    const { error } = await createClient().from("consents").upsert(
      {
        senior_id: seniorId,
        scope,
        granted: to,
        granted_at: to ? new Date().toISOString() : null,
        granted_by: "family",
      },
      { onConflict: "senior_id,scope" },
    );
    setBusy(null);
    if (error) {
      setFailed(scope);
      return;
    }
    setGranted((g) => ({ ...g, [scope]: to }));
  }

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
              {failed === c.scope && <small className="consent__failed">Could not save that. Try again.</small>}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby={`consent-${c.scope}`}
              className="consent__switch"
              onClick={() => void flip(c.scope, !on)}
              disabled={busy === c.scope}
            >
              <i aria-hidden="true" />
              <span>{busy === c.scope ? "…" : on ? "On" : "Off"}</span>
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
        .consent__failed { color: var(--risk-high); font-weight: 600; }
        .consent__switch:disabled { opacity: .6; cursor: default; }
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
