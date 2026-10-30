"use client";

import { useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";
import { fmt } from "@/lib/i18n";
import type { AppCopy } from "@/lib/i18n-app";
import type { AssistanceRequest, RequestState } from "@/lib/requests";

/**
 * The errand queue: what seniors have asked for, and what was done about it.
 *
 * TWO STEPS, NOT ONE, AND THAT IS THE WHOLE POINT. Raising a request is easy
 * and most prototypes stop there — an alert appears, somebody nods, the demo
 * moves on. What a family actually wants to know is whether the thing got
 * done. So "arranged" and "confirmed" are separate: "I have rung the chemist"
 * and "the medicines are in the house" are different facts, and collapsing
 * them into one button would let this product tell a daughter her mother has
 * her tablets when nobody has checked.
 *
 * "Not needed" is a real outcome and is recorded as its own state rather than
 * as done. A request that turned out not to be one must not be counted among
 * the things this system fixed.
 *
 * EVERY WRITE GOES THROUGH RLS as the signed-in coordinator. There is no
 * elevated function here and no senior id trusted from the page: the policy
 * on assistance_requests decides whether this row belongs to this person, and
 * a request outside their caseload simply updates nothing.
 */

const KIND_FALLBACK = "other";

export function RequestQueue({
  requests,
  t,
}: {
  requests: AssistanceRequest[];
  t: AppCopy["requests"];
}) {
  // Rows are held locally so the queue responds immediately, and dropped from
  // view once finished. The server list is the truth on the next load.
  const [rows, setRows] = useState(requests);
  const [busy, setBusy] = useState<number | null>(null);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<number | null>(null);

  async function move(row: AssistanceRequest, to: RequestState, withNote?: string) {
    setBusy(row.id);
    setFailed(null);
    const patch: Record<string, unknown> = { state: to };
    if (to === "arranged") {
      patch.arranged_at = new Date().toISOString();
      if (withNote?.trim()) patch.arranged_note = withNote.trim();
    }
    if (to === "confirmed") patch.confirmed_at = new Date().toISOString();

    const { error } = await createClient()
      .from("assistance_requests")
      .update(patch)
      .eq("id", row.id);

    setBusy(null);
    if (error) {
      setFailed(row.id);
      return;
    }
    setNoteFor(null);
    setNote("");
    if (to === "arranged") {
      setRows((rs) =>
        rs.map((r) =>
          r.id === row.id ? { ...r, state: "arranged", arrangedNote: withNote?.trim() || r.arrangedNote } : r,
        ),
      );
    } else {
      setRows((rs) => rs.filter((r) => r.id !== row.id));
    }
  }

  if (!rows.length) return null;

  return (
    <section className="rq">
      <h2 className="rq__head">
        {t.title}
        <span className="rq__count">{rows.length}</span>
      </h2>

      <ul className="rq__list">
        {rows.map((r) => {
          const kind = t.kinds[r.kind as keyof typeof t.kinds] ?? t.kinds[KIND_FALLBACK];
          const emergency = r.kind === "emergency";
          return (
            <li key={r.id} className={emergency ? "rq__row rq__row--sos" : "rq__row"}>
              <div className="rq__top">
                <i className="rq__avatar" aria-hidden="true">
                  {r.initials}
                </i>
                <span className="rq__who">
                  <Link href={`/senior/${r.seniorId}`} className="rq__name">
                    {r.name}
                  </Link>
                  <small>
                    {kind}
                    {r.source === "sos_button" ? ` · ${t.viaButton}` : ` · ${t.viaCall}`}
                  </small>
                </span>
                {emergency ? (
                  <span className="pill pill--high">{t.now}</span>
                ) : r.urgent ? (
                  <span className="pill pill--med">{t.urgent}</span>
                ) : null}
              </div>

              <p className="rq__what">{r.summary}</p>
              {/* Their own words, not the system's reading of them. Somebody
                  deciding what to do needs to see what was actually said. */}
              {r.said && <p className="rq__said">“{r.said}”</p>}
              {r.state === "arranged" && (
                <p className="rq__arranged">
                  {t.arrangedLabel}
                  {r.arrangedNote ? `: ${r.arrangedNote}` : ""}
                </p>
              )}

              {failed === r.id && <p className="rq__failed">{t.failed}</p>}

              {noteFor === r.id ? (
                <form
                  className="rq__noteform"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void move(r, "arranged", note);
                  }}
                >
                  <label htmlFor={`rq-note-${r.id}`}>{t.notePrompt}</label>
                  <span>
                    <input
                      id={`rq-note-${r.id}`}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t.notePlaceholder}
                      autoComplete="off"
                    />
                    <button type="submit" className="rq__btn rq__btn--go" disabled={busy === r.id}>
                      {t.save}
                    </button>
                  </span>
                </form>
              ) : (
                <div className="rq__acts">
                  {r.state === "open" ? (
                    <button
                      type="button"
                      className="rq__btn rq__btn--go"
                      onClick={() => {
                        setNoteFor(r.id);
                        setNote("");
                      }}
                      disabled={busy === r.id}
                    >
                      {t.arrange}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rq__btn rq__btn--go"
                      onClick={() => void move(r, "confirmed")}
                      disabled={busy === r.id}
                    >
                      {t.confirm}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rq__btn"
                    onClick={() => void move(r, "cancelled")}
                    disabled={busy === r.id}
                  >
                    {t.notNeeded}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="rq__foot">{fmt(t.foot, { count: rows.length })}</p>

      <style>{`
        .rq {
          border: 1px solid var(--line); border-left: 3px solid var(--forest);
          border-radius: var(--radius-lg); background: var(--white);
          padding: var(--s-5) var(--s-6); margin-bottom: var(--s-6);
        }
        .rq__head {
          display: flex; align-items: center; gap: var(--s-3);
          font-family: var(--sans); font-size: var(--fs-xs); font-weight: 600;
          letter-spacing: .07em; text-transform: uppercase; color: var(--forest);
          margin: 0 0 var(--s-5);
        }
        .rq__count {
          font-size: var(--fs-xs); letter-spacing: 0;
          background: var(--sage); color: var(--forest);
          border-radius: var(--radius-pill); padding: 1px var(--s-3);
        }
        .rq__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-5); }
        .rq__row {
          display: grid; gap: var(--s-3);
          padding-top: var(--s-5); border-top: 1px solid var(--line);
        }
        .rq__row:first-child { padding-top: 0; border-top: 0; }
        /* An emergency does not look like an errand. */
        .rq__row--sos {
          background: #fdeceb; border: 1px solid var(--risk-high);
          border-radius: var(--radius); padding: var(--s-4); margin-top: 0;
        }
        .rq__top { display: flex; align-items: center; gap: var(--s-3); }
        .rq__avatar {
          width: 34px; height: 34px; border-radius: 50%; flex: none;
          background: var(--sage); color: var(--forest);
          display: grid; place-items: center;
          font-size: var(--fs-xs); font-weight: 700; font-style: normal;
        }
        .rq__who { display: grid; gap: 1px; min-width: 0; margin-right: auto; }
        .rq__name {
          font-weight: 600; font-size: 1.0625rem; color: var(--ink); text-decoration: none;
        }
        .rq__name:hover { text-decoration: underline; text-underline-offset: 3px; }
        .rq__who small { color: var(--ink-3); font-size: var(--fs-xs); }
        .rq__what { margin: 0; font-size: var(--fs-sm); line-height: 1.6; color: var(--ink-2); }
        .rq__said {
          margin: 0; font-size: var(--fs-sm); line-height: 1.6; color: var(--ink-3);
          font-style: italic; padding-left: var(--s-4);
          border-left: 2px solid var(--line-2);
        }
        .rq__arranged { margin: 0; font-size: var(--fs-xs); color: var(--forest); font-weight: 600; }
        .rq__failed { margin: 0; font-size: var(--fs-xs); color: var(--risk-high); }

        .rq__acts { display: flex; gap: var(--s-3); flex-wrap: wrap; }
        .rq__btn {
          font: inherit; font-size: var(--fs-xs); font-weight: 600;
          min-height: 2.5rem; padding-inline: var(--s-4);
          border: 1px solid var(--line-2); border-radius: var(--radius-pill);
          background: var(--white); color: var(--ink-2); cursor: pointer;
        }
        .rq__btn--go { border-color: var(--forest); color: var(--forest); }
        .rq__btn:disabled { opacity: .55; cursor: default; }

        .rq__noteform { display: grid; gap: var(--s-2); }
        .rq__noteform label { font-size: var(--fs-xs); color: var(--ink-3); }
        .rq__noteform span { display: flex; gap: var(--s-2); flex-wrap: wrap; }
        .rq__noteform input {
          font: inherit; font-size: var(--fs-sm); flex: 1; min-width: 12rem;
          padding: var(--s-2) var(--s-3);
          border: 1px solid var(--line); border-radius: var(--radius);
          background: var(--white); color: var(--ink);
        }
        .rq__foot {
          margin: var(--s-5) 0 0; font-size: var(--fs-xs);
          line-height: 1.6; color: var(--ink-3); max-width: 60ch;
        }
        /* iOS zooms the page in when a focused field's text is under 16px. */
        @media (max-width: 40rem) {
          .rq__noteform input { font-size: 1rem; }
        }
      `}</style>
    </section>
  );
}
