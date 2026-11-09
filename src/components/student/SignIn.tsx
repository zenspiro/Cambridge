"use client";
// Sign-in for students and parents: email, then the 6-digit code, in place (no reload). The server answers with
// fixed codes; the words are here. A first sign-in creates the account, so the same words show for everyone.
import { useState } from "react";
import { ACCOUNT } from "@/lib/config";

const MESSAGES: Readonly<Record<string, string>> = {
  bad_email: "That does not look like an email address. Please check it.",
  busy: "Too many tries for now. Please wait a little and try again.",
  closed: "Sign-in is not open yet. Please try again later.",
  not_sent: "We could not send the code just now. Please try again in a minute.",
  bad_code: "That code is not right. Check the latest email and try again.",
  expired: "That code has run out. Ask for a new one.",
  too_many: "Too many wrong codes. Ask for a new one.",
  failed: "Something went wrong. Please try again.",
  forbidden: "Something went wrong. Please reload the page and try again.",
  bad_request: "Something went wrong. Please reload the page and try again.",
};

async function post(path: string, body: Record<string, string>): Promise<{ ok?: boolean; error?: string; next?: string; ref?: string }> {
  try {
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await r.json()) as { ok?: boolean; error?: string; next?: string };
  } catch {
    return { error: "failed" };
  }
}

export function SignIn({ google, next }: { google: boolean; next?: string | null }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null);

  const say = (r: { error?: string; ref?: string }) =>
    setNote({ good: false, text: `${MESSAGES[r.error ?? "failed"] ?? MESSAGES.failed}${r.ref ? ` Reference: ${r.ref}` : ""}` });

  async function sendCode() {
    setBusy(true);
    setNote(null);
    const r = await post("/account/code", { email });
    setBusy(false);
    if (r.ok) {
      setStep("code");
      setCode("");
      setNote({ good: true, text: `We sent a ${ACCOUNT.codeLength}-digit code to ${email.trim()}. It works for ${ACCOUNT.codeMinutes} minutes.` });
    } else say(r);
  }

  async function checkCode() {
    setBusy(true);
    setNote(null);
    const r = await post("/account/verify", next ? { email, code, next } : { email, code });
    if (r.ok && r.next?.startsWith("/")) {
      window.location.assign(r.next);
      return;
    }
    setBusy(false);
    say(r);
  }

  return (
    <section className="s-card s-auth" aria-label="Sign in">
      <h1 className="s-h1">Sign in</h1>
      {step === "email" ? (
        <form className="s-form" onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
          <label className="s-field">
            <span className="s-label">Your email</span>
            <input className="s-input" type="email" name="email" autoComplete="email" required maxLength={ACCOUNT.maxEmailLength} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className="s-btn s-btn-primary s-btn-block" type="submit" disabled={busy}>Send my code</button>
          <p className="s-muted">New here? The same code creates your account.</p>
        </form>
      ) : (
        <form className="s-form" onSubmit={(e) => { e.preventDefault(); void checkCode(); }}>
          <label className="s-field">
            <span className="s-label">The code from the email</span>
            <input className="s-input s-input-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern={`[0-9 ]{${ACCOUNT.codeLength},${ACCOUNT.codeLength + 2}}`} required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="s-btn s-btn-primary s-btn-block" type="submit" disabled={busy}>Sign in</button>
          <div className="s-row">
            <button className="s-link-btn" type="button" disabled={busy} onClick={() => void sendCode()}>Send a new code</button>
            <button className="s-link-btn" type="button" disabled={busy} onClick={() => { setStep("email"); setNote(null); }}>Use another email</button>
          </div>
        </form>
      )}
      {note ? <p className={note.good ? "s-note s-note-good" : "s-note s-note-bad"} role="status">{note.text}</p> : null}
      {google ? (
        <form className="s-form" method="post" action="/account/google">
          <div className="s-or"><span>or</span></div>
          <button className="s-btn s-btn-block" type="submit">Continue with Google</button>
        </form>
      ) : null}
    </section>
  );
}
