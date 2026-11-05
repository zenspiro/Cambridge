import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentBrand, getEnv } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { requireAccount } from "@/lib/account/server";
import { homeFor } from "@/lib/account/roles";
import { birthYears, examYears, getProfile, listExamPlans } from "@/lib/account/profile";
import { myFamily } from "@/lib/account/family";
import { countryOptions } from "@/lib/countries";
import { listSubjects, subjectLabel } from "@/lib/library/catalog";
import { ACCOUNT, FAMILY, PARENT_THEME, SESSION_LABELS } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";
import { SignOut } from "@/components/student/SignOut";
import { StudentNotice } from "@/components/student/Notice";
import { DetailsFields } from "@/components/student/DetailsFields";
import { PARENT_NAV, STUDENT_NAV } from "@/components/student/nav";
import { ActionForm } from "@/components/ActionForm";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { ThemePicker } from "@/components/student/ThemePicker";

export const metadata: Metadata = { title: "Me" };

const MESSAGES = {
  ok_saved: "Saved.",
  ok_theme: "Theme changed.",
  ok_exam: "Exam session saved.",
  ok_removed: "Removed.",
  bad_details: "Please type your first and last name (letters only) and pick your country.",
  bad_theme: "Please pick one of the themes.",
  bad_exam: "Please pick a subject, a session and a year.",
  ok_joined: "You joined your family.",
  ok_left: "You left the family.",
  bad_code: "That code does not work. Check it with your parent, or ask them for a new one.",
  in_family: "You are already in a family.",
  full: `That family is full (up to ${FAMILY.maxChildren} children).`,
  not_student: "Only students can join a family.",
  too_young: "You can leave once you are over the age for parent approval.",
  no_family: "You are not in a family.",
  busy: "Too many changes for now. Please wait a little.",
};

/** The person's own page: details, theme and exam sessions (students), download or delete their data. */
export default async function MePage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string }> }) {
  const s = await requireAccount();
  if (!s.roles.length || s.standing !== "ok") redirect(homeFor(s.roles, s.standing));
  const q = await searchParams;
  const db = (await getEnv()).DB;
  const brand = await currentBrand();
  const student = s.roles.includes("student");
  const year = new Date().getUTCFullYear();
  const [profile, plans, subjects, family] = await Promise.all([
    getProfile(db, s.userId),
    student ? listExamPlans(db, s.userId) : [],
    student ? listSubjects(db) : [],
    student ? myFamily(db, s.userId) : null,
  ]);
  const theme = student ? (s.theme ?? brand.defaultTheme) : PARENT_THEME;
  return (
    <StudentFrame brand={frameBrand(brand)} theme={theme} nav={student ? STUDENT_NAV : PARENT_NAV} current="/me" actions={<SignOut />}>
      <h1 className="s-h1">Me</h1>
      <StudentNotice code={q.e} messages={MESSAGES} errorRef={q.ref} />

      <section className="s-card" aria-label="Your details">
        <h2 className="s-h2">Your details</h2>
        <p className="s-muted">Signed in as {s.email}</p>
        <ActionForm className="s-form" action="/account/profile" messages={MESSAGES}>
          <label className="s-field">
            <span className="s-label">First name</span>
            <input className="s-input" name="firstName" autoComplete="given-name" required maxLength={ACCOUNT.maxNameLength} defaultValue={s.firstName} />
          </label>
          <label className="s-field">
            <span className="s-label">Last name</span>
            <input className="s-input" name="lastName" autoComplete="family-name" required maxLength={ACCOUNT.maxNameLength} defaultValue={s.lastName} />
          </label>
          <DetailsFields countries={countryOptions()} years={student ? birthYears(year) : null} country={profile.country} birthYear={profile.birthYear} lockedYear={Boolean(profile.approvedAt)} />
          <button className="s-btn s-btn-primary" type="submit">Save</button>
        </ActionForm>
      </section>

      {student ? (
        <section className="s-card" aria-label="Theme">
          <h2 className="s-h2">Theme</h2>
          <p className="s-muted">Only the look changes; everything else stays the same.</p>
          <ThemePicker current={theme} />
        </section>
      ) : null}

      {student ? (
        <section className="s-card" id="exams" aria-label="Exam sessions">
          <h2 className="s-h2">Your exams</h2>
          <p className="s-muted">When do you sit each subject? Your home page counts down to it.</p>
          {plans.length ? (
            <ul className="s-list">
              {plans.map((p) => (
                <li className="s-list-row" key={p.code}>
                  <span>{subjectLabel(subjects, p.code)}: {SESSION_LABELS[p.session]} {p.year}</span>
                  <ActionForm action="/account/exam/remove" messages={MESSAGES}>
                    <input type="hidden" name="code" value={p.code} />
                    <button className="s-link-btn" type="submit">Remove</button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : null}
          <ActionForm className="s-form" action="/account/exam/add" messages={MESSAGES}>
            <label className="s-field">
              <span className="s-label">Subject</span>
              <select className="s-input" name="code" required defaultValue="">
                <option value="" disabled>Choose a subject</option>
                {subjects.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
              </select>
            </label>
            <div className="s-inline">
              <label className="s-field">
                <span className="s-label">Session</span>
                <select className="s-input" name="session" defaultValue="s">
                  {(["s", "w", "m"] as const).map((x) => <option key={x} value={x}>{SESSION_LABELS[x]}</option>)}
                </select>
              </label>
              <label className="s-field">
                <span className="s-label">Year</span>
                <select className="s-input" name="year" defaultValue={year + 1}>
                  {examYears(year).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
            </div>
            <button className="s-btn" type="submit">Add exam</button>
          </ActionForm>
        </section>
      ) : null}

      {student ? (
        <section className="s-card" id="family" aria-label="Your family">
          <h2 className="s-h2">Your family</h2>
          {family ? (
            <>
              <p>You are in {family.parentFirstName} {family.parentLastName}&apos;s family (parent).</p>
              {family.canLeave ? (
                <ActionForm action="/account/family/leave" messages={MESSAGES} confirm="Leave this family?">
                  <button className="s-btn" type="submit">Leave the family</button>
                </ActionForm>
              ) : null}
            </>
          ) : (
            <ActionForm className="s-form" action="/account/family/join" messages={MESSAGES}>
              <label className="s-field">
                <span className="s-label">Join my family: your parent&apos;s family code</span>
                <input className="s-input s-input-code" name="code" required autoComplete="off" maxLength={FAMILY.codeLength + 2} />
              </label>
              <button className="s-btn" type="submit">Join</button>
            </ActionForm>
          )}
        </section>
      ) : null}

      <section className="s-card" aria-label="Your data">
        <h2 className="s-h2">Your data</h2>
        <p className="s-muted">Download everything we hold about you, or delete your account and all of it.</p>
        <div className="s-actions">
          <a className="s-btn" href="/account/export">Download my data</a>
          <form method="post" action="/account/delete">
            <ConfirmSubmit className="s-btn s-btn-danger" label="Delete my account" question="Delete your account and everything in it? This cannot be undone." yes="Yes, delete" />
          </form>
        </div>
      </section>
    </StudentFrame>
  );
}
