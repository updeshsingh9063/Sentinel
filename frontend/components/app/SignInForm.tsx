"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { IconArrow, IconLock } from "@/components/ui/Icons";
import { fmt } from "@/lib/i18n";
import type { AppCopy } from "@/lib/i18n-app";
import { createClient } from "@/lib/supabase/client";
import {
  DEMO_CARD_ROLES,
  DEMO_PASSWORD,
  DEMO_USERS,
  ROLE_ORDER,
  type AuthRole,
  type DemoRole,
  isDemoRole,
  mayOpen,
} from "@/lib/session";

/**
 * Sign in, or create a real account.
 *
 * A client component because signing in is a browser call, so its copy arrives
 * as a prop — next/headers cannot reach a client bundle.
 *
 * THE ROLE FIELD IS A REQUEST, NOT A GRANT. It travels as sign-up metadata,
 * which the user controls completely, so the database clamps it: the trigger
 * in migration 0005 maps anything outside coordinator/family/ops down to
 * family, and `admin` is not reachable by registering at all. Nothing here is
 * load-bearing for access control.
 *
 * The demo accounts stay because confirmation email on this project's free
 * tier is rate-limited to a few an hour. A judge should never be locked out of
 * the product by an email that has not arrived.
 */

/**
 * `forgot` asks for a reset link; `reset` is where the link lands. They are
 * modes of this form rather than pages of their own so that the split layout,
 * the language switch and the demo cards are all still there — someone locked
 * out needs the demo cards more than anyone, and a bare password box on an
 * unfamiliar route is exactly what a phishing page looks like.
 */
type Mode = "signin" | "signup" | "forgot" | "reset";

/** Whether the link that landed on /signin?flow=reset still carries a session. */
type Recovery = "checking" | "ready" | "expired";

const ROLE_CHOICES: AuthRole[] = ["coordinator", "family", "ops"];

export function SignInForm({
  t,
  /**
   * The senior whose line the check-in card opens, read from the database
   * rather than the copy file. The copy carried a fixture name the cohort
   * loader replaced long ago, so the card named a person this database has
   * never heard of — and the call it opens files to somebody else entirely.
   */
  seniorName = "",
}: {
  t: AppCopy;
  seniorName?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const flow = params.get("flow");

  const [mode, setMode] = useState<Mode>(flow === "reset" ? "reset" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AuthRole>("family");
  const [recovery, setRecovery] = useState<Recovery>(
    flow === "reset" ? "checking" : "ready",
  );

  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState<DemoRole | null>(null);
  // The OAuth callback cannot render a message itself, so it redirects back
  // here with ?error= and this picks it up.
  const [error, setError] = useState<string | null>(params.get("error"));
  const [notice, setNotice] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  const roleLabel: Record<AuthRole, string> = {
    coordinator: t.signin.roleCoordinator,
    family: t.signin.roleFamily,
    ops: t.signin.roleOps,
  };

  /**
   * A reset link grants a real session, so "did the link work" is answered by
   * asking whether we have a user — not by trusting the URL. getUser()
   * revalidates against the auth server rather than reading a cookie, which
   * matters here because the whole page hangs off the answer.
   */
  useEffect(() => {
    if (flow !== "reset") return;
    if (params.get("expired")) {
      setRecovery("expired");
      return;
    }
    let live = true;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (live) setRecovery(data.user ? "ready" : "expired");
      });
    return () => {
      live = false;
    };
  }, [flow, params]);

  function go(r: DemoRole) {
    const dest = next && mayOpen(r, next) ? next : DEMO_USERS[r].home;
    router.push(dest);
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();

    if (mode === "signin") {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        setError(err.message);
        setBusy(false);
        return;
      }
      // Role comes from the session, not from this form.
      router.push(next || "/worklist");
      router.refresh();
      return;
    }

    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, demo_role: role } },
    });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }

    // Two possible outcomes, depending on whether the project requires email
    // confirmation. Both are normal; the message says which happened rather
    // than leaving someone staring at an unchanged form.
    if (data.session) {
      setNotice(t.signin.confirmedNote);
      router.push(DEMO_USERS[role].home);
      router.refresh();
      return;
    }
    setNotice(t.signin.checkEmail);
    setMode("signin");
    setBusy(false);
  }

  /**
   * Ask for a reset link.
   *
   * THIS FORM MUST NOT BECOME A WAY TO TEST WHETHER AN ADDRESS HAS AN ACCOUNT
   * HERE. Supabase deliberately answers the same whether or not the user
   * exists, and this says the same thing back either way: "if an account
   * exists for that address". Branching on the answer would turn a convenience
   * into a way to enumerate the families and coordinators on this system.
   * Genuine failures — a rate limit, SMTP being down — are shown, because
   * those are actionable and reveal nothing about who is registered.
   */
  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    // A demo account's mailbox does not exist, so a link sent there never
    // arrives and the person waits for nothing. Its password is printed a few
    // centimetres further down the page; say so instead.
    const typed = email.trim().toLowerCase();
    const isDemo = ROLE_ORDER.some((r) => DEMO_USERS[r].email?.toLowerCase() === typed);
    if (isDemo) {
      setError(null);
      setNotice(fmt(t.signin.forgotDemo, { password: DEMO_PASSWORD }));
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?flow=recovery`,
    });
    if (err) setError(err.message);
    else setNotice(t.signin.forgotSent);
    setBusy(false);
  }

  /** Set the new password, using the session the reset link established. */
  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setError(t.signin.resetMismatch);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    const { data, error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      // Supabase refuses a password identical to the current one. Its wording
      // is for developers; this one is for whoever is locked out.
      setError(
        /different from the old|should be different|same.*password/i.test(err.message)
          ? t.signin.resetSame
          : err.message,
      );
      setBusy(false);
      return;
    }

    setNotice(t.signin.resetDone);
    // The role decides where they land. If the metadata is missing, the
    // middleware corrects the guess on arrival rather than this file holding a
    // second copy of the routing rules.
    const r = data.user?.user_metadata?.demo_role as string | undefined;
    router.push(isDemoRole(r) ? DEMO_USERS[r].home : "/summary");
    router.refresh();
  }

  async function google() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setError(null);
    const supabase = createClient();
    const q = next ? `?next=${encodeURIComponent(next)}` : "";
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback${q}` },
    });
    // On success the browser has already left for Google, so only a failure
    // ever gets here — most often the provider not being enabled yet.
    if (err) {
      setError(err.message);
      setGoogleBusy(false);
    }
  }

  async function demo(r: DemoRole) {
    const u = DEMO_USERS[r];
    if (!u.email) {          // the senior has no account
      setDemoBusy(r);
      router.push(u.home);
      return;
    }
    setDemoBusy(r);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({
      email: u.email,
      password: DEMO_PASSWORD,
    });
    if (err) {
      setError(err.message);
      setDemoBusy(null);
      return;
    }
    go(r);
  }

  /**
   * Leave the reset flow. The URL has to be cleaned up as well as the state:
   * ?flow=reset is what makes the PAGE call itself "Choose a new password",
   * so leaving it behind would put that heading over a sign-in form.
   */
  function leaveReset(to: Mode = "signin") {
    setMode(to);
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirm("");
    if (flow) router.replace("/signin");
  }

  // WHERE A RESET LINK LANDS. One job, so the tabs, the Google button and the
  // demo cards all stand down until it is finished — the person arrived here
  // from their email to do exactly one thing.
  if (mode === "reset") {
    return (
      <>
        {/* No heading here: the page itself is titled "Choose a new password"
            when ?flow=reset is set, and saying it twice would read as a
            template that forgot to fill one of them in. */}
        {recovery === "checking" && <p className="si__sub">{t.signin.resetChecking}</p>}

        {recovery === "expired" && (
          <div className="si__resetState">
            <p className="si__error" role="alert">
              {params.get("reason") === "pkce"
                ? t.signin.resetWrongBrowser
                : t.signin.resetExpired}
            </p>
            <button
              type="button"
              className="btn btn--forest si__submit"
              onClick={() => {
                setRecovery("ready");
                leaveReset("forgot");
              }}
            >
              {t.signin.forgotSubmit}
            </button>
          </div>
        )}

        {recovery === "ready" && (
          <>
            {error && <p className="si__error" role="alert">{error}</p>}
            {notice && <p className="si__notice" role="status">{notice}</p>}

            <form className="si__form" onSubmit={savePassword}>
              <label className="si__field">
                <span>{t.signin.resetNew}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  autoFocus
                />
                <small>{t.signin.passwordHint}</small>
              </label>

              {/* Typed twice, because there is no way back from a typo here:
                  the link is single-use, and a password saved wrong locks the
                  account out again with no second link waiting. */}
              <label className="si__field">
                <span>{t.signin.resetConfirm}</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>

              <button type="submit" className="btn btn--forest si__submit" disabled={busy}>
                {busy ? t.signin.working : t.signin.resetSubmit}
              </button>
            </form>
          </>
        )}

        <button type="button" className="si__link si__link--away" onClick={() => leaveReset()}>
          {t.signin.backToSignIn}
        </button>
        <FormStyles />
      </>
    );
  }

  return (
    <>
      {next && (
        <p className="si__redirect">
          <IconLock size={15} />
          {t.signin.redirect} <code>{next}</code>
        </p>
      )}

      <div className="si__tabs" role="tablist">
        {(["signin", "signup"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? "si__tab si__tab--on" : "si__tab"}
            onClick={() => {
              setMode(m);
              setError(null);
              setNotice(null);
              setPassword("");
              setConfirm("");
            }}
          >
            {m === "signin" ? t.signin.tabSignIn : t.signin.tabSignUp}
          </button>
        ))}
      </div>

      {error && <p className="si__error" role="alert">{error}</p>}
      {notice && <p className="si__notice" role="status">{notice}</p>}

      {mode === "forgot" && (
        <div className="si__forgotHead">
          <h2 className="si__formTitle">{t.signin.forgotTitle}</h2>
          <p className="si__sub">{t.signin.forgotBody}</p>
        </div>
      )}

      {mode !== "forgot" && (
      <>
      <button
        type="button"
        className="si__google"
        onClick={google}
        disabled={googleBusy || busy}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7Z" />
          <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.700l-.3.1-6.7 5.2-.1.3C7.9 40.9 15.4 46 24 46Z" />
          <path fill="#FBBC05" d="M11.5 27.8c-.5-1.4-.7-2.9-.7-4.3s.3-3 .7-4.3v-.4l-6.8-5.3-.2.1A22 22 0 0 0 2 23.5c0 3.5.9 6.9 2.5 9.9l7-5.6Z" />
          <path fill="#EA4335" d="M24 9.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.3 29.9 1 24 1 15.4 1 7.9 6.1 4.5 13.6l7 5.6C13.3 13.3 18.2 9.5 24 9.5Z" />
        </svg>
        {googleBusy ? t.signin.working : t.signin.google}
      </button>
      <p className="si__hint si__hint--centre">{t.signin.googleNote}</p>

      <p className="si__divider"><span>{t.signin.oauthDivider}</span></p>
      </>
      )}

      <form className="si__form" onSubmit={mode === "forgot" ? sendReset : submit}>
        {mode === "signup" && (
          <label className="si__field">
            <span>{t.signin.fullName}</span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              required
            />
          </label>
        )}

        <label className="si__field">
          <span>{t.signin.email}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        {mode !== "forgot" && (
          <label className="si__field">
            <span className="si__labelRow">
              {t.signin.password}
              {mode === "signin" && (
                <button
                  type="button"
                  className="si__link si__link--inline"
                  onClick={() => {
                    setMode("forgot");
                    setError(null);
                    setNotice(null);
                    setPassword("");
                  }}
                >
                  {t.signin.forgot}
                </button>
              )}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={8}
              required
            />
            {mode === "signup" && <small>{t.signin.passwordHint}</small>}
          </label>
        )}

        {mode === "signup" && (
          <fieldset className="si__field si__roles-pick">
            <legend>{t.signin.role}</legend>
            {ROLE_CHOICES.map((r) => (
              <label key={r} className="si__radio">
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={role === r}
                  onChange={() => setRole(r)}
                />
                <span>{roleLabel[r]}</span>
              </label>
            ))}
          </fieldset>
        )}

        <button type="submit" className="btn btn--forest si__submit" disabled={busy}>
          {busy
            ? t.signin.working
            : mode === "signin"
              ? t.signin.submitSignIn
              : mode === "forgot"
                ? t.signin.forgotSubmit
                : t.signin.submitSignUp}
        </button>

        {mode === "signup" && <p className="si__hint">{t.signin.emptyAccountNote}</p>}
        {mode === "forgot" && (
          <>
            <p className="si__hint">{t.signin.forgotSlow}</p>
            <button type="button" className="si__link" onClick={() => leaveReset()}>
              {t.signin.backToSignIn}
            </button>
          </>
        )}
      </form>

      <p className="si__divider"><span>{t.signin.demoDivider}</span></p>
      <p className="si__hint si__hint--centre">{t.signin.demoHint}</p>

      <ul className="si__roles">
        {DEMO_CARD_ROLES.map((r) => {
          const u = DEMO_USERS[r];
          const who = t.roles[r];
          return (
            <li key={r}>
              <button
                type="button"
                className="si__card"
                onClick={() => demo(r)}
                disabled={demoBusy !== null || busy}
                aria-busy={demoBusy === r}
              >
                <span className="si__avatar" aria-hidden="true">{u.initials}</span>
                <span className="si__text">
                  <span className="si__name">
                    {r === "senior" && seniorName ? seniorName : who.name}
                  </span>
                  <span className="si__label">
                    {who.label}
                    {!u.email && ` · ${t.signin.noAccount}`}
                  </span>
                  <span className="si__sees">{who.sees}</span>
                </span>
                <span className="si__go" aria-hidden="true">
                  <IconArrow size={17} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <FormStyles />
    </>
  );
}

/**
 * The handful of rules the reset flow adds. Everything else it uses — fields,
 * buttons, errors — already exists on the sign-in page, which is most of the
 * reason these are modes of this form rather than a route of their own.
 */
function FormStyles() {
  return (
    <style>{`
      .si__formTitle {
        font-family: var(--display); font-size: 1.5rem; line-height: 1.2;
        margin: 0 0 var(--s-2);
      }
      .si__forgotHead { margin: var(--s-6) 0 var(--s-5); }
      .si__link--away { display: inline-block; margin-top: var(--s-5); }
      .si__resetState { display: grid; gap: var(--s-4); margin-top: var(--s-6); }
      .si__labelRow {
        display: flex; align-items: baseline; justify-content: space-between;
        gap: var(--s-3);
      }
      .si__link {
        background: none; border: 0; padding: 0; cursor: pointer;
        font: inherit; color: var(--forest);
        text-decoration: underline; text-underline-offset: 3px;
      }
      .si__link:hover { opacity: .75; }
      /* Sits beside the "Password" label, so it must not shout louder than
         the field it belongs to. */
      .si__link--inline { font-size: var(--fs-xs); font-weight: 400; }
      form > .si__link { margin-top: var(--s-3); justify-self: start; }
    `}</style>
  );
}
