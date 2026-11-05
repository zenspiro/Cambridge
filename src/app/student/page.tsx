import type { Metadata } from "next";
import { currentBrand, getEnv } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { requireRole } from "@/lib/account/server";
import { getProfile, listExamPlans } from "@/lib/account/profile";
import { listSubjects, subjectLabel } from "@/lib/library/catalog";
import { SESSION_LABELS } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";
import { SignOut } from "@/components/student/SignOut";
import { STUDENT_NAV } from "@/components/student/nav";
import { ActionForm } from "@/components/ActionForm";

export const metadata: Metadata = { title: "Home" };

/** Student home. Practice, plan and grades arrive in Phase 3 (docs/PLAN.md); for now the exam sessions. */
export default async function StudentHome() {
  const s = await requireRole("student");
  const db = (await getEnv()).DB;
  const brand = await currentBrand();
  const [profile, plans] = await Promise.all([getProfile(db, s.userId), listExamPlans(db, s.userId)]);
  const subjects = plans.length ? await listSubjects(db) : [];
  return (
    <StudentFrame brand={frameBrand(brand)} theme={s.theme ?? brand.defaultTheme} nav={STUDENT_NAV} current="/student" actions={<SignOut />}>
      <h1 className="s-h1">Hi, {s.firstName}</h1>
      {!plans.length && !profile.examSkippedAt ? (
        <section className="s-card s-feature" aria-label="Your exams">
          <h2 className="s-h2">When are your exams?</h2>
          <p>Tell us when you sit each subject and we will count down with you.</p>
          <div className="s-actions">
            <a className="s-btn s-btn-primary" href="/me#exams">Add my exams</a>
            <ActionForm action="/account/exam/skip" messages={{}}>
              <button className="s-btn" type="submit">Skip for now</button>
            </ActionForm>
          </div>
        </section>
      ) : null}
      {plans.length ? (
        <section className="s-card" aria-label="Your exams">
          <h2 className="s-h2">Your exams</h2>
          <ul className="s-list">
            {plans.map((p) => <li className="s-list-row" key={p.code}>{subjectLabel(subjects, p.code)}<span className="s-muted">{SESSION_LABELS[p.session]} {p.year}</span></li>)}
          </ul>
        </section>
      ) : null}
      <section className="s-card">
        <h2 className="s-h2">Your plan shows here</h2>
        <p className="s-muted">Practice questions, your predicted grades and a daily plan are on the way. We will email you when they open.</p>
      </section>
    </StudentFrame>
  );
}
