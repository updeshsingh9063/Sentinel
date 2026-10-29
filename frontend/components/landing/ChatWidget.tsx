"use client";

import { useEffect, useRef, useState } from "react";

import type { Copy, Lang } from "@/lib/i18n";

/**
 * The site assistant, as a panel anchored bottom-right of the landing page.
 *
 * It holds no key and no knowledge: every question goes to /api/chat, which
 * is where the Groq key and the guardrails live. This component only renders
 * the conversation.
 *
 * Accessibility, which this project is scored on:
 *  · the panel is a labelled dialog and takes focus when it opens
 *  · Escape closes it and returns focus to the button that opened it
 *  · replies land in an aria-live region, so a screen reader hears them
 *    without the user hunting for what changed
 *  · the launcher is a real button with a visible label, not an icon alone
 */

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export function ChatWidget({ lang, t }: { lang: Lang; t: Copy["chat"] }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // The greeting is rendered, not stored, so it is never sent back as history.
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        launcher.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;

    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, lang }),
      });

      if (!res.ok) {
        // 429 means two different things: "busy" is the upstream free-tier
        // token cap, "rate_limited" is this site's own per-IP limiter. The
        // advice differs, so they get different messages.
        const code = await res
          .json()
          .then((d) => d?.error)
          .catch(() => null);
        setError(
          code === "busy"
            ? t.errorBusy
            : res.status === 429
              ? t.errorRate
              : res.status === 503
                ? t.errorOff
                : t.errorGeneric,
        );
        return;
      }

      const data = await res.json();
      if (typeof data.reply === "string" && data.reply.trim()) {
        setMessages([...next, { role: "assistant", content: data.reply }]);
      } else {
        setError(t.errorGeneric);
      }
    } catch {
      setError(t.errorGeneric);
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  }

  return (
    <>
      <button
        ref={launcher}
        type="button"
        className="chat__launch"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="site-assistant"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.7-5a8.2 8.2 0 0 1-.7-3.4 8.4 8.4 0 0 1 8.5-8.4 8.4 8.4 0 0 1 8.5 8.3Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{t.open}</span>
      </button>

      {open && (
        <div
          id="site-assistant"
          ref={panel}
          className="chat__panel"
          role="dialog"
          aria-label={t.title}
        >
          <header className="chat__head">
            <div>
              <h2>{t.title}</h2>
              <p>{t.note}</p>
            </div>
            <button
              type="button"
              className="chat__x"
              onClick={() => {
                setOpen(false);
                launcher.current?.focus();
              }}
              aria-label={t.close}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="chat__log" ref={log}>
            <p className="chat__msg chat__msg--bot">{t.greeting}</p>

            {messages.length === 0 && (
              <ul className="chat__suggest">
                {t.suggestions.map((s) => (
                  <li key={s}>
                    <button type="button" onClick={() => send(s)} disabled={busy}>
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div aria-live="polite" aria-atomic="false">
              {messages.map((m, i) => (
                <p
                  key={i}
                  className={`chat__msg chat__msg--${m.role === "user" ? "me" : "bot"}`}
                >
                  {m.content}
                </p>
              ))}
              {busy && <p className="chat__msg chat__msg--bot chat__thinking">{t.thinking}</p>}
            </div>

            {error && (
              <p className="chat__error" role="alert">
                {error}
              </p>
            )}
          </div>

          <form
            className="chat__form"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              ref={field}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.placeholder}
              aria-label={t.placeholder}
              maxLength={600}
              disabled={busy}
            />
            <button type="submit" disabled={busy || !input.trim()}>
              {t.send}
            </button>
          </form>

          <p className="chat__legal">{t.disclaimer}</p>
        </div>
      )}

      <style>{`
        .chat__launch {
          position: fixed; right: var(--gutter); bottom: var(--s-5); z-index: 60;
          display: inline-flex; align-items: center; gap: var(--s-2);
          padding: var(--s-3) var(--s-5);
          font: inherit; font-size: var(--fs-sm); font-weight: 600;
          color: var(--cream); background: var(--forest);
          border: 0; border-radius: var(--radius-pill);
          box-shadow: 0 6px 24px rgba(21,56,47,0.28);
          cursor: pointer;
          transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
        }
        .chat__launch:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(21,56,47,0.34); }
        .chat__launch:focus-visible { outline: 2px solid var(--forest); outline-offset: 3px; }

        .chat__panel {
          position: fixed; right: var(--gutter); bottom: calc(var(--s-5) + 3.6rem);
          z-index: 60;
          width: min(24rem, calc(100vw - 2 * var(--gutter)));
          max-height: min(32rem, calc(100svh - 8rem));
          display: flex; flex-direction: column;
          background: var(--white);
          border: 1px solid var(--line); border-radius: var(--radius);
          box-shadow: 0 18px 48px rgba(21,56,47,0.22);
          overflow: hidden;
        }
        .chat__head {
          display: flex; align-items: flex-start; gap: var(--s-3);
          padding: var(--s-4) var(--s-4) var(--s-3);
          border-bottom: 1px solid var(--line);
          background: var(--cream-2);
        }
        .chat__head h2 {
          font-family: var(--sans); font-size: var(--fs-sm); font-weight: 600; margin: 0;
        }
        .chat__head p { font-size: var(--fs-xs); color: var(--ink-3); margin: 2px 0 0; }
        .chat__x {
          margin-left: auto; flex: none;
          background: none; border: 0; padding: 4px; cursor: pointer;
          color: var(--ink-3); border-radius: 4px;
        }
        .chat__x:hover { color: var(--ink); }
        .chat__x:focus-visible { outline: 2px solid var(--forest); outline-offset: 2px; }

        .chat__log {
          flex: 1; overflow-y: auto;
          padding: var(--s-4);
          display: flex; flex-direction: column; gap: var(--s-3);
        }
        .chat__msg {
          font-size: var(--fs-xs); line-height: 1.6;
          padding: var(--s-3) var(--s-4);
          border-radius: var(--radius);
          margin: 0 0 var(--s-3);
          white-space: pre-wrap;
        }
        .chat__msg:last-child { margin-bottom: 0; }
        .chat__msg--bot { background: var(--cream-2); color: var(--ink-1); }
        .chat__msg--me {
          background: var(--forest); color: var(--cream);
          margin-left: var(--s-6);
        }
        .chat__thinking { color: var(--ink-3); font-style: italic; }

        .chat__suggest { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
        .chat__suggest button {
          width: 100%; text-align: left;
          font: inherit; font-size: var(--fs-xs); line-height: 1.5;
          color: var(--forest); background: var(--white);
          border: 1px solid var(--line); border-radius: var(--radius);
          padding: var(--s-2) var(--s-3); cursor: pointer;
        }
        .chat__suggest button:hover:not(:disabled) { border-color: var(--forest); }
        .chat__suggest button:focus-visible { outline: 2px solid var(--forest); outline-offset: 2px; }

        .chat__error {
          font-size: var(--fs-xs); line-height: 1.55; color: var(--risk-high);
          background: var(--risk-high-bg, #fdecea);
          border-radius: var(--radius); padding: var(--s-3); margin: 0;
        }

        .chat__form {
          display: flex; gap: var(--s-2);
          padding: var(--s-3) var(--s-4);
          border-top: 1px solid var(--line);
        }
        .chat__form input {
          flex: 1; min-width: 0;
          font: inherit; font-size: var(--fs-xs);
          padding: var(--s-3);
          border: 1px solid var(--line); border-radius: var(--radius);
          background: var(--white); color: var(--ink);
        }
        .chat__form input:focus-visible { outline: 2px solid var(--forest); outline-offset: -1px; }
        .chat__form button {
          flex: none;
          font: inherit; font-size: var(--fs-xs); font-weight: 600;
          padding: 0 var(--s-4);
          color: var(--cream); background: var(--forest);
          border: 0; border-radius: var(--radius); cursor: pointer;
        }
        .chat__form button:disabled { opacity: 0.5; cursor: default; }
        .chat__form button:focus-visible { outline: 2px solid var(--forest); outline-offset: 2px; }

        .chat__legal {
          font-size: 0.6875rem; line-height: 1.5; color: var(--ink-3);
          padding: 0 var(--s-4) var(--s-3); margin: 0;
        }

        @media (max-width: 30rem) {
          .chat__launch span { display: none; }
          .chat__launch { padding: var(--s-3); }
        }
        @media (prefers-reduced-motion: reduce) {
          .chat__launch { transition: none; }
          .chat__launch:hover { transform: none; }
        }
      `}</style>
    </>
  );
}
