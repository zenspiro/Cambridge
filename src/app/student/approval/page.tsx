import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentBrand, getEnv } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { requireRole } from "@/lib/account/server";
import { birthYears, latestConsent } from "@/lib/account/profile";
import { countryOptions } from "@/lib/countries";
import { ACCOUNT, CONSENT } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";
import { SignOut } from "@/components/student/SignOut";
import { StudentNotice } from "@/components/student/Notice";
import { DetailsFields } from "@/components/student/DetailsFields";
import { ActionForm } from "@/components/ActionForm";

export const metadata: Metadata = { title: "Waiting for your parent" };

const MESSAGES = {
  ok_sent: "Sent. Ask your parent to check their email (and the spam folder).",
  bad_email: "That does not look like an email address. Please check it.",
  same_email: "That is your own email. Please type your parent's or guardian's email.",
  busy: "Too many emails for today. Please try again tomorrow.",
  not_sent: "We could not send the email just now. Please try again in a minute.",
  not_needed: "No approval is needed any more.",
  bad_details: "Please pick your country and birth year.",
};

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** A student who is not let in yet: details first (accounts from before step 3), then the parent's approval. */
export default async function ApprovalPage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string }> }) {
  const s = await requireRole("student", { waiting: true });
  if (s.standing === "ok") redirect("/student");
  const q = await searchParams;
  const brand = await currentBrand();
  const last = s.standing === "pending" ? await latestConsent((await getEnv()).DB, s.userId) : null;
  const waiting = last && last.status === "pending" && last.expiresAt > Date.now() ? last : null;
  return (
    <StudentFrame brand={frameBrand(brand)} theme={s.theme ?? brand.defaultTheme} nav={[]} current="" actions={<SignOut />}>
      <StudentNotice code={q.e} messages={MESSAGES} errorRef={q.ref} />
      {s.standing === "details" ? (
        <section className="s-card s-auth" aria-label="Your details">
          <h1 className="s-h1">One more step</h1>
          <p className="s-muted">Please tell us your country and birth year.</p>
          <form className="s-form" method="post" action="/account/details">
            <DetailsFields countries={countryOptions()} years={birthYears(new Date().getUTCFullYear())} country={null} birthYear={null} />
            <button className="s-btn s-btn-primary s-btn-block" type="submit">Continue</button>
          </form>
        </section>
      ) : (
        <section className="s-card s-auth" aria-label="Waiting for your parent">
          <h1 className="s-h1">Ask a parent to approve</h1>
          <p>Hi {s.firstName}. Before you start, a parent or guardian needs to say yes. We email them a link; it takes them one tap.</p>
          {waiting ? (
            <p className="s-note s-note-good">We emailed {waiting.parentEmail} on {day(waiting.createdAt)}. The link works until {day(waiting.expiresAt)}. This page opens up as soon as they approve.</p>
          ) : last?.status === "pending" ? (
            <p className="s-note s-note-bad">The link we sent to {last.parentEmail} has run out. Send a new one below.</p>
          ) : null}
          <ActionForm className="s-form" action="/account/consent" messages={MESSAGES}>
            <label className="s-field">
              <span className="s-label">{waiting ? "Send again, or to another email" : "Your parent's or guardian's email"}</span>
              <input className="s-input" type="email" name="parentEmail" required maxLength={ACCOUNT.maxEmailLength} defaultValue={waiting?.parentEmail ?? ""} />
            </label>
            <button className="s-btn s-btn-primary s-btn-block" type="submit">{waiting ? "Send the link again" : "Send the link"}</button>
          </ActionForm>
          <p className="s-muted">Up to {CONSENT.sendsPerStudentPerDay} emails a day. If they decline, your account is deleted.</p>
        </section>
      )}
    </StudentFrame>
  );
}
