import type { Metadata } from "next";
import { currentBrand, getEnv } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { requireRole } from "@/lib/account/server";
import { linkApproved, listChildren, liveCode, showCode, waitingForParent } from "@/lib/account/family";
import { birthYears } from "@/lib/account/profile";
import { countryOptions } from "@/lib/countries";
import { listSubjects, subjectLabel } from "@/lib/library/catalog";
import { ACCOUNT, FAMILY, PARENT_THEME, SESSION_LABELS } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";
import { SignOut } from "@/components/student/SignOut";
import { StudentNotice } from "@/components/student/Notice";
import { DetailsFields } from "@/components/student/DetailsFields";
import { PARENT_NAV } from "@/components/student/nav";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export const metadata: Metadata = { title: "Family" };

const MESSAGES = {
  ok_code: "Here is your family code. Your child types it on their Me page.",
  ok_created: "Account made. Your child signs in with their own email; a code is sent there.",
  ok_approved: "Approved. They are in your family now.",
  ok_removed: "Removed from your family. Their account stays.",
  ok_deleted: "Their account and everything in it has been deleted.",
  has_account: "That email already has an account. Ask your child to join with your family code instead.",
  full: `A family can have up to ${FAMILY.maxChildren} children.`,
  bad_child: "Please type your child's first and last name, their own email (not yours), and pick their country and birth year.",
  not_found: "That did not work. Please reload the page and try again.",
  not_parent: "Only parents can do that.",
  busy: "Too many tries for now. Please wait a little.",
};

const day = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const STATUS = { ok: "Active", pending: "Waiting for approval", details: "Still setting up" } as const;

/** Parent home, always in the calm look: their children, approvals waiting for them, adding a child. */
export default async function ParentHome({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string }> }) {
  const s = await requireRole("parent");
  const q = await searchParams;
  const db = (await getEnv()).DB;
  // Children this parent approved by email join by themselves (owner decision).
  await linkApproved(db, s.userId, s.email);
  const [children, waiting, code, brand] = await Promise.all([listChildren(db, s.userId), waitingForParent(db, s.email), liveCode(db, s.userId), currentBrand()]);
  const subjects = children.some((c) => c.exams.length) ? await listSubjects(db) : [];
  return (
    <StudentFrame brand={frameBrand(brand)} theme={PARENT_THEME} nav={PARENT_NAV} current="/parent" actions={<SignOut />}>
      <h1 className="s-h1">Hi, {s.firstName}</h1>
      <StudentNotice code={q.e} messages={MESSAGES} errorRef={q.ref} />

      {waiting.map((w) => (
        <section className="s-card s-feature" key={w.id} aria-label="Waiting for your approval">
          <h2 className="s-h2">{w.firstName} {w.lastName} is waiting for you</h2>
          <p>They asked you to approve their account. You can do it here instead of from the email.</p>
          <ActionForm action="/account/family/approve" messages={MESSAGES}>
            <input type="hidden" name="request" value={w.id} />
            <button className="s-btn s-btn-primary" type="submit">Approve</button>
          </ActionForm>
        </section>
      ))}

      <section className="s-stack" aria-label="Your children">
        <h2 className="s-h2">Your children</h2>
        {children.length ? children.map((c) => (
          <article className="s-card" key={c.id} aria-label={`${c.firstName} ${c.lastName}`}>
            <div className="s-row">
              <h3 className="s-h2">{c.firstName} {c.lastName}</h3>
              <span className="s-chip">{STATUS[c.standing]}</span>
            </div>
            <span className="s-muted">{c.email}</span>
            {c.exams.length ? (
              <ul className="s-list">
                {c.exams.map((e) => <li className="s-list-row" key={e.code}>{subjectLabel(subjects, e.code)}<span className="s-muted">{SESSION_LABELS[e.session]} {e.year}</span></li>)}
              </ul>
            ) : <span className="s-muted">No exam sessions added yet.</span>}
            <p className="s-muted">Progress, weak topics and mock results show here once practice opens.</p>
            <div className="s-actions">
              <a className="s-btn s-btn-small" href={`/account/family/export?child=${encodeURIComponent(c.id)}`}>Download their data</a>
              <ActionForm action="/account/family/remove" messages={MESSAGES} confirm={`Remove ${c.firstName} from your family? Their account stays.`}>
                <input type="hidden" name="child" value={c.id} />
                <button className="s-btn s-btn-small" type="submit">Remove</button>
              </ActionForm>
              <form method="post" action="/account/family/delete">
                <input type="hidden" name="child" value={c.id} />
                <ConfirmSubmit className="s-btn s-btn-small s-btn-danger" label="Delete account" question={`Delete ${c.firstName}'s account and everything in it?`} yes="Yes, delete" />
              </form>
            </div>
          </article>
        )) : <p className="s-muted">No children yet. Add one below.</p>}
      </section>

      <section className="s-card" aria-label="Add a child who has an account">
        <h2 className="s-h2">Add a child who already has an account</h2>
        {code ? (
          <>
            <p>Your family code: <strong className="s-code">{showCode(code.code)}</strong></p>
            <p className="s-muted">Your child signs in, opens Me and types it under "Join my family". It works until {day(code.expiresAt)}.</p>
          </>
        ) : <p className="s-muted">Make a family code and give it to your child. It works for {FAMILY.codeDays} days.</p>}
        <ActionForm action="/account/family/code" messages={MESSAGES}>
          <button className="s-btn" type="submit">{code ? "Make a new code" : "Make a family code"}</button>
        </ActionForm>
        <p className="s-muted">If you approved your child from our email, they join your family by themselves when you sign in with that email.</p>
      </section>

      <details className="s-card s-fold">
        <summary className="s-h2 s-summary">Make an account for your child</summary>
        <p className="s-muted">Your child needs their own email; they sign in with a code sent there. Accounts you make count as approved.</p>
        <ActionForm className="s-form" action="/account/family/child" messages={MESSAGES}>
          <label className="s-field">
            <span className="s-label">First name</span>
            <input className="s-input" name="firstName" required maxLength={ACCOUNT.maxNameLength} />
          </label>
          <label className="s-field">
            <span className="s-label">Last name</span>
            <input className="s-input" name="lastName" required maxLength={ACCOUNT.maxNameLength} />
          </label>
          <label className="s-field">
            <span className="s-label">Your child&apos;s email</span>
            <input className="s-input" name="email" type="email" required maxLength={ACCOUNT.maxEmailLength} />
          </label>
          <DetailsFields countries={countryOptions()} years={birthYears(new Date().getUTCFullYear())} country={null} birthYear={null} />
          <button className="s-btn s-btn-primary" type="submit">Make the account</button>
        </ActionForm>
      </details>
    </StudentFrame>
  );
}
