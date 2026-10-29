"use client";

import { useEffect, useState } from "react";

import { fmt } from "@/lib/i18n";
import { VoiceAnswer } from "@/components/app/VoiceAnswer";
import { matchDigit, matchFeeling, matchPain, matchYesNo } from "@/lib/checkin-intent";
import type { AppCopy } from "@/lib/i18n-app";
import { createClient } from "@/lib/supabase/client";

/**
 * Senior check-in: a simulator for the phone call, not a product surface.
 *
 * The brief forbids an app for seniors, so this page exists to demonstrate the
 * IVR loop end to end in the pitch. A real deployment puts a telephony
 * provider in front of the same backend handlers; nothing here assumes a
 * screen, which is the point.
 *
 * Accessibility is 15% of the judged score, which is why this is P0 rather
 * than a stretch goal: 22px base type, 72px targets, three choices, and every
 * answer is a single keypad digit so it works on the handset a senior already
 * owns. Hindi leads and English follows, because Hindi is what the call is in.
 *
 * It also handles the answer nobody gives. A key not pressed is a signal, not
 * a missing value, and the summary at the end says so out loud.
 */

/**
 * EACH QUESTION CARRIES ITS OWN OPTIONS.
 *
 * All three used to share Better / Same / Worse. On screen that was merely
 * odd for the medicine question; once the options are read aloud it becomes
 * plainly wrong — "Did you take your medicine? Press one for Better." The
 * keypad digits still mean the same thing to the risk model (1 best, 3 worst),
 * so only the wording changed.
 */
const SCRIPT = [
  {
    key: "feeling",
    hi: "आज आप कैसा महसूस कर रहे हैं?",
    roman: "Aaj aap kaisa mehsoos kar rahe hain?",
    en: "How are you feeling today?",
    options: [
      { code: 1, hi: "बेहतर", roman: "Behtar", en: "Better" },
      { code: 2, hi: "वैसा ही", roman: "Waisa hi", en: "Same" },
      { code: 3, hi: "खराब", roman: "Kharab", en: "Worse" },
    ],
  },
  {
    key: "pain",
    hi: "क्या आपको कहीं दर्द है?",
    roman: "Kya aapko kahin dard hai?",
    en: "Do you have pain anywhere?",
    options: [
      { code: 1, hi: "नहीं", roman: "Nahi", en: "No pain" },
      { code: 2, hi: "थोड़ा", roman: "Thoda", en: "A little" },
      { code: 3, hi: "बहुत", roman: "Bahut", en: "A lot" },
    ],
  },
  {
    key: "meds",
    hi: "क्या आपने आज दवाई ली?",
    roman: "Kya aapne aaj dawai li?",
    en: "Did you take your medicine today?",
    // Short headline labels: these are read aloud, and a comma inside the
    // label makes the spoken prompt stumble ("haan, le li ke liye ek").
    // The fuller wording still shows on screen as the subtitle.
    options: [
      { code: 1, hi: "हाँ", roman: "Haan, le li", en: "Yes, taken" },
      { code: 3, hi: "नहीं", roman: "Nahi, bhool gaya", en: "No, missed it" },
    ],
  },
  {
    key: "sleep",
    hi: "कल रात नींद कैसी आई?",
    roman: "Kal raat neend kaisi aayi?",
    en: "How did you sleep last night?",
    options: [
      { code: 1, hi: "अच्छी", roman: "Achhi", en: "Well" },
      { code: 2, hi: "ठीक-ठाक", roman: "Theek-thaak", en: "So-so" },
      { code: 3, hi: "ठीक नहीं", roman: "Theek nahi", en: "Badly" },
    ],
  },
  {
    key: "appetite",
    hi: "आज खाना ठीक से खाया?",
    roman: "Aaj khana theek se khaya?",
    en: "Have you eaten properly today?",
    options: [
      { code: 1, hi: "हाँ", roman: "Haan", en: "Yes" },
      { code: 2, hi: "थोड़ा", roman: "Thoda", en: "A little" },
      { code: 3, hi: "नहीं", roman: "Nahi", en: "No" },
    ],
  },
  {
    // Asked last on purpose. It is the only question here that can describe
    // something that already went wrong, and opening a welfare call with it
    // sets the wrong tone. Asked plainly, because "did you have a fall" is
    // what a person actually says — and a senior who did fall often will not
    // volunteer it unless asked directly.
    key: "fall",
    hi: "क्या आप कहीं गिरे या फिसले?",
    roman: "Kya aap kahin gire ya phisle?",
    en: "Have you had a fall or a slip?",
    options: [
      { code: 1, hi: "नहीं", roman: "Nahi", en: "No" },
      { code: 2, hi: "लगभग", roman: "Lagbhag", en: "Nearly" },
      { code: 3, hi: "हाँ", roman: "Haan", en: "Yes" },
    ],
  },
];

/** Spoken as "<option> ke liye <digit>", the way an IVR prompt reads. */
const DIGIT_HI: Record<number, string> = { 1: "एक", 2: "दो", 3: "तीन" };

/**
 * What the handset actually says.
 *
 * Hindi ALWAYS, because that is the language of the call. The website's
 * language is a convenience for whoever is looking at this simulator; it is
 * not the senior's language, and tying what she hears to it would be wrong.
 * English is appended only when the page is in English, so a reviewer who
 * does not read Hindi still follows along.
 */
function speechFor(q: (typeof SCRIPT)[number], lang: string) {
  const hindi = [
    { text: q.hi, lang: "hi-IN" },
    {
      text:
        q.options.map((o) => `${o.hi} के लिए ${DIGIT_HI[o.code]}`).join(", ") +
        "। या अपनी बात बोलकर बताइए।",
      lang: "hi-IN",
    },
  ];
  const english = [
    { text: q.en, lang: "en-IN" },
    {
      text:
        q.options.map((o) => `press ${o.code} for ${o.en}`).join(", ") +
        ". Or just say your answer.",
      lang: "en-IN",
    },
  ];

  // Hindi only in Hindi mode — the call is in Hindi and repeating it in
  // English would be noise for the person it is meant for.
  if (lang === "hi") return hindi;

  // In English mode the site language leads, matching what is on screen, and
  // the Hindi follows so a reviewer still hears what the senior would.
  return [...english, ...hindi];
}

export function CheckinSim({ t, lang }: { t: AppCopy["checkin"]; lang: string }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  // What was actually SAID, kept beside the code. The code is a lossy
  // three-way summary; the sentence is the evidence, and the coordinator sees
  // both. Nothing here interprets the words further.
  const [spoken, setSpoken] = useState<Record<string, string>>({});
  const [unclear, setUnclear] = useState<string | null>(null);
  /** Where the completed call landed, once it has. */
  const [filed, setFiled] = useState<
    { state: "sending" } | { state: "done"; name: string } | { state: "failed" } | null
  >(null);
  /** Whose line this is, asked for before anyone starts answering. */
  const [lineName, setLineName] = useState("");

  useEffect(() => {
    let live = true;
    createClient()
      .rpc("demo_line_name")
      .then(({ data }) => {
        if (live && typeof data === "string") setLineName(data);
      });
    return () => {
      live = false;
    };
  }, []);

  const question = SCRIPT[step];
  const done = step >= SCRIPT.length;

  /**
   * File the completed call.
   *
   * IT WRITES TO EXACTLY ONE SENIOR, AND CANNOT BE POINTED AT ANOTHER. This
   * page is public, because a senior has no account and the brief forbids
   * giving them one, so a public insert into `checkins` would let anyone file
   * answers for a named person -- and those answers feed the risk model, so a
   * stranger could move a real senior up or down a coordinator's worklist.
   *
   * `record_demo_checkin` takes no senior id at all. Its target is looked up
   * from a flag inside the function (migration 0013), so there is no payload
   * that reaches anybody else. Forging it forges the same synthetic demo
   * record everyone already demonstrates with.
   *
   * The two channels that CAN write to any senior are both authenticated: the
   * telephony webhook, which proves itself with a shared secret, and a
   * signed-in coordinator logging a call as themselves under RLS.
   */
  async function file(all: Record<string, number | null>) {
    setFiled({ state: "sending" });
    const { data, error } = await createClient().rpc("record_demo_checkin", {
      p_feeling: all.feeling ?? null,
      p_pain: all.pain ?? null,
      p_meds: all.meds ?? null,
      p_sleep: all.sleep ?? null,
      p_appetite: all.appetite ?? null,
      p_fall: all.fall ?? null,
    });
    const out = data as { ok?: boolean; senior_name?: string } | null;
    // A failure is shown as a failure. Saying the answers reached a
    // coordinator when they did not is the one thing this screen must never
    // do -- it is the sentence a senior is being asked to trust.
    if (error || !out?.ok) setFiled({ state: "failed" });
    else setFiled({ state: "done", name: out.senior_name ?? "" });
  }

  function record(code: number | null, transcript?: string) {
    const key = SCRIPT[step].key;
    const all = { ...answers, [key]: code };
    setAnswers(all);
    if (transcript) setSpoken({ ...spoken, [key]: transcript });
    setUnclear(null);
    setStep(step + 1);
    // Sent once, when the last question is answered -- a real call is filed
    // when it ends, not question by question.
    if (step + 1 >= SCRIPT.length) void file(all);
  }

  /**
   * A spoken answer. The third question is yes/no, the first two are the
   * three-way scale, so they are mapped by different matchers.
   *
   * An answer that maps to nothing is NOT coerced to the nearest option. It
   * asks again, because a guess is indistinguishable downstream from
   * something the senior actually said.
   */
  function onSpoken(transcript: string) {
    const q = SCRIPT[step];
    const key = q.key;

    // Numbers first. The prompt just read the options out as digits, so a
    // spoken digit is the likeliest answer there is — and checking sentiment
    // first would leave "do" and "tu" falling through as unrecognised.
    const digit = matchDigit(transcript, q.options.map((o) => o.code));
    if (digit !== null) { record(digit, transcript); return; }

    // YES/NO QUESTIONS DO NOT ALL POINT THE SAME WAY, and getting that
    // backwards records the opposite of what the senior said.
    //
    //   "Did you take your medicine?"  yes is GOOD  -> 1
    //   "Have you eaten properly?"     yes is GOOD  -> 1
    //   "Have you had a fall?"         yes is BAD   -> 3
    //
    // So the polarity is declared per question rather than assumed from the
    // shape of the answer.
    const YES_IS_GOOD: Record<string, boolean> = {
      meds: true,
      appetite: true,
      fall: false,
    };

    if (key in YES_IS_GOOD) {
      const m = matchYesNo(transcript);
      if (m.value === null) { setUnclear(t.unclear); return; }
      const good = YES_IS_GOOD[key] ? m.value : !m.value;
      record(good ? 1 : 3, transcript);
      return;
    }

    // feeling and sleep both run better / same / worse, which is what
    // matchFeeling returns. Pain has its own scale.
    const m = key === "pain" ? matchPain(transcript) : matchFeeling(transcript);
    if (m.value === null) { setUnclear(t.unclear); return; }
    record(m.value, transcript);
  }

  function restart() {
    setAnswers({});
    setSpoken({});
    setUnclear(null);
    setStep(0);
    setFiled(null);
  }

  return (
    <div className="ivr">
      {/* WHOSE LINE THIS IS, SAID BEFORE THE FIRST QUESTION. The call files
          to one designated senior, and until this said so a person could
          answer six questions and then search the coordinator's dashboard
          for whichever name the card they clicked happened to show. The
          feature worked; it was simply not saying who it was. */}
      <p className="ivr__chrome">
        {t.chrome}
        {lineName && <span className="ivr__line">{fmt(t.lineOf, { name: lineName })}</span>}
      </p>

      <main className="ivr__phone senior-scale">
        {done ? (
          <>
            {lang === "hi" ? (
              <>
                <p className="ivr__hi">धन्यवाद। आपकी बात पहुँच गई है।</p>
                <p className="ivr__roman">Dhanyavaad. Aapki baat pahunch gayi hai.</p>
                <p className="ivr__en">Thank you. Your answers have reached the coordinator.</p>
              </>
            ) : (
              <>
                <p className="ivr__lead">Thank you. Your answers have reached the coordinator.</p>
                <p className="ivr__deva">धन्यवाद। आपकी बात पहुँच गई है।</p>
              </>
            )}

            <ul className="ivr__recap">
              {SCRIPT.map((q) => {
                const a = answers[q.key];
                const choice = q.options.find((c) => c.code === a);
                return (
                  <li key={q.key}>
                    <span>{lang === "hi" ? q.hi : q.en}</span>
                    <strong data-missed={a === null ? "" : undefined}>
                      {a === null ? t.noKeyPressed : `${a} — ${lang === "hi" ? choice?.hi : choice?.en}`}
                    </strong>
                    {spoken[q.key] && (
                      <em className="ivr__said">
                        {t.heard}: <q>{spoken[q.key]}</q>
                      </em>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="ivr__note">{t.recapNote}</p>

            {/* The spoken lines above are the SCRIPT -- what a senior hears
                down the line. This is what the system actually did with the
                call, which is a different claim and gets its own sentence. */}
            {filed?.state === "sending" && <p className="ivr__filed">{t.filing}</p>}
            {filed?.state === "done" && (
              <p className="ivr__filed ivr__filed--ok">
                {fmt(t.filedTo, { name: filed.name })} {t.filedWhere}
              </p>
            )}
            {filed?.state === "failed" && (
              <p className="ivr__filed ivr__filed--bad" role="alert">{t.fileFailed}</p>
            )}

            <button type="button" className="btn btn--outline ivr__again" onClick={restart}>
              {t.again}
            </button>
          </>
        ) : (
          <>
            <p className="ivr__step">{fmt(t.step, { n: step + 1, total: SCRIPT.length })}</p>
            {/* The headline follows the SITE language; the other scripts stay
                beneath it. What is SPOKEN is always Hindi, because that is the
                language of the call — but a reviewer reading in English should
                see the switch do something, and previously the biggest text on
                the page stayed Devanagari either way. */}
            {lang === "hi" ? (
              <>
                <p className="ivr__hi">{question.hi}</p>
                <p className="ivr__roman">{question.roman}</p>
                <p className="ivr__en">{question.en}</p>
              </>
            ) : (
              <>
                <p className="ivr__lead">{question.en}</p>
                {/* The Devanagari stays — it is what she actually hears down
                    the line, and a reviewer should see that. The romanisation
                    does not: it exists for someone who speaks Hindi but cannot
                    read the script, which is nobody reading this page in
                    English. */}
                <p className="ivr__deva">{question.hi}</p>
              </>
            )}

            {/* key forces a fresh instance per question. Without it the
                component keeps its own `heard` text from the previous answer,
                so the screen still shows the last thing the senior said while
                asking something new — which reads exactly like "it ignored
                me" even though the answer was recorded and the step advanced. */}
            <VoiceAnswer
              key={question.key}
              t={t}
              speech={speechFor(question, lang)}
              listenLang={lang}
              onAnswer={onSpoken}
            />

            {unclear && <p className="ivr__unclear" role="alert">{unclear}</p>}

            {step > 0 && (() => {
              const prev = SCRIPT[step - 1];
              const code = answers[prev.key];
              const chosen = prev.options.find((o) => o.code === code);
              return (
                <p className="ivr__done" role="status">
                  ✓ {lang === "hi" ? prev.hi : prev.en} —{" "}
                  <strong>
                    {chosen ? (lang === "hi" ? chosen.hi : chosen.en) : t.noKeyPressed}
                  </strong>
                  {spoken[prev.key] ? ` (${spoken[prev.key]})` : ""}
                </p>
              );
            })()}

            <p className="ivr__or">{t.orPress}</p>

            <div className="ivr__keys">
              {question.options.map((c) => (
                <button key={c.code} type="button" className="ivr__key" onClick={() => record(c.code)}>
                  <span className="ivr__digit">{c.code}</span>
                  <span>
                    <span className={lang === "hi" ? "ivr__keyhi" : "ivr__keylead"}>
                      {lang === "hi" ? c.hi : c.en}
                    </span>
                    <span className="ivr__keyen">
                      {lang === "hi" ? `${c.roman} · ${c.en}` : c.hi}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <button type="button" className="ivr__silent" onClick={() => record(null)}>
              {t.silent}
            </button>
          </>
        )}
      </main>

      <style>{`
        .ivr {
          min-height: 100svh;
          /* Transparent, not cream. The page behind this places a photograph
             of an empty room under the whole surface, and a solid fill here
             covered every pixel of it. Where there is no photograph the page
             itself is still cream, so this loses nothing. */
          background: transparent;
          display: grid; align-content: start; justify-items: center;
          padding: var(--s-6) var(--gutter) var(--s-16);
        }
        .ivr__line { display: block; margin-top: 2px; font-weight: 600; }
        .ivr__chrome {
          font-size: var(--fs-xs); color: var(--ink-3);
          margin-bottom: var(--s-5); text-align: center;
        }
        .ivr__phone {
          width: 100%; max-width: 32rem;
          background: var(--white);
          border: 1px solid var(--line);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-card);
          padding: var(--s-8) var(--s-6);
        }
        .ivr__step {
          font-size: 0.8rem; font-weight: 600; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--ink-3); margin-bottom: var(--s-5);
        }
        .ivr__hi { font-family: var(--deva); font-size: 1.75rem; line-height: 1.5; }
        .ivr__roman { font-size: 1.125rem; color: var(--ink-2); margin-top: var(--s-2); }
        .ivr__en { font-size: 1rem; color: var(--ink-3); margin-top: var(--s-1); }
        .ivr__lead { font-size: 1.75rem; line-height: 1.4; }
        .ivr__deva {
          font-family: var(--deva); font-size: 1.25rem; line-height: 1.5;
          color: var(--ink-2); margin-top: var(--s-2);
        }

        .ivr__keys { display: grid; gap: var(--s-3); margin-top: var(--s-8); }
        .ivr__key {
          display: flex; align-items: center; gap: var(--s-4);
          min-height: 4.5rem; width: 100%;
          padding: var(--s-3) var(--s-5);
          text-align: left;
          background: var(--white);
          border: 2px solid var(--line-2);
          border-radius: var(--radius);
          cursor: pointer; font: inherit;
          transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
        }
        .ivr__key:hover { border-color: var(--forest); background: var(--sage); }
        .ivr__key:focus-visible { outline: 3px solid var(--forest); outline-offset: 3px; }
        .ivr__digit {
          flex: none;
          width: 3rem; height: 3rem; border-radius: 50%;
          background: var(--forest); color: var(--on-dark);
          display: grid; place-items: center;
          font-size: 1.5rem; font-weight: 700;
        }
        .ivr__keyhi { display: block; font-family: var(--deva); font-size: 1.375rem; line-height: 1.4; }
        .ivr__keylead { display: block; font-size: 1.375rem; line-height: 1.4; }
        .ivr__keyen { display: block; font-size: 0.9375rem; color: var(--ink-3); }

        .ivr__silent {
          margin-top: var(--s-6); width: 100%;
          background: none; border: 0; padding: var(--s-3);
          font: inherit; font-size: 1rem; color: var(--ink-3);
          text-decoration: underline; text-underline-offset: 4px; cursor: pointer;
        }
        .ivr__silent:hover { color: var(--ink); }

        .ivr__recap { list-style: none; margin: var(--s-8) 0 0; padding: 0; display: grid; gap: var(--s-3); }
        .ivr__recap li {
          display: flex; justify-content: space-between; gap: var(--s-4);
          font-size: 1rem; padding-bottom: var(--s-3);
          border-bottom: 1px solid var(--line);
        }
        .ivr__recap span { color: var(--ink-3); }
        .ivr__recap strong { font-weight: 600; text-align: right; }
        .ivr__recap strong[data-missed] { color: var(--risk-med); }
        .ivr__note { margin-top: var(--s-5); font-size: 0.9375rem; line-height: 1.6; color: var(--ink-3); }
        .ivr__again { margin-top: var(--s-6); }
        .ivr__said {
          display: block; margin-top: 4px;
          font-size: 0.9375rem; font-style: normal; color: var(--ink-3);
        }
        .ivr__unclear {
          margin-bottom: var(--s-4); padding: var(--s-3) var(--s-4);
          background: var(--risk-med-bg, #fbefd7);
          border-radius: var(--radius);
          font-size: 1rem; line-height: 1.6; color: var(--risk-med, #8d620f);
        }
        .ivr__filed {
          margin-top: var(--s-4); padding: var(--s-3) var(--s-4);
          border-radius: 10px; font-size: 1rem; line-height: 1.6;
          background: var(--cream-2); color: var(--ink-2);
        }
        .ivr__filed--ok  { background: #eef3ec; color: var(--forest); }
        .ivr__filed--bad { background: #fbeceb; color: #8a2a21; }

        .ivr__done {
          margin: 0 0 var(--s-4); padding: var(--s-3) var(--s-4);
          background: var(--risk-low-bg, #e4f1e4);
          border-radius: var(--radius);
          font-size: 1rem; line-height: 1.5; color: var(--risk-low, #2f6b3c);
        }
        .ivr__or {
          margin: 0 0 var(--s-3); font-size: 0.9375rem; color: var(--ink-3);
        }
      `}</style>
    </div>
  );
}
