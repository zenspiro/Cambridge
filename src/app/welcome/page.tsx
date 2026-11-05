import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentBrand } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { requireAccount } from "@/lib/account/server";
import { homeFor } from "@/lib/account/roles";
import { ACCOUNT } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";

export const metadata: Metadata = { title: "Welcome" };

const ROLE_WORDS = {
  student: { title: "I'm a student", note: "Practise, get marked and see your grade go up." },
  parent: { title: "I'm a parent", note: "Follow your children's progress." },
} as const;

/** First sign-in only: student or parent, and the person's name. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ e?: string; ref?: string }> }) {
  const s = await requireAccount();
  if (s.roles.length) redirect(homeFor(s.roles));
  const q = await searchParams;
  const brand = await currentBrand();
  return (
    <StudentFrame brand={frameBrand(brand)} theme={brand.defaultTheme} nav={[]} current="">
      <section className="s-card s-auth" aria-label="Welcome">
        <h1 className="s-h1">Welcome to {brand.name}</h1>
        <p className="s-muted">Two quick questions and you are in.</p>
        {q.e === "bad" ? <p className="s-note s-note-bad" role="alert">Please choose student or parent and type your first and last name (letters only).</p> : null}
        {q.ref && /^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/.test(q.ref) ? <p className="s-note s-note-bad" role="alert">Something went wrong. Reference: {q.ref}</p> : null}
        <form className="s-form" method="post" action="/account/welcome">
          <fieldset className="s-choices">
            <legend className="s-label">Who are you?</legend>
            {ACCOUNT.roles.map((r, i) => (
              <label className="s-choice" key={r}>
                <input type="radio" name="role" value={r} required defaultChecked={i === 0} />
                <span className="s-choice-main">
                  <span className="s-task-title">{ROLE_WORDS[r].title}</span>
                  <span className="s-muted">{ROLE_WORDS[r].note}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="s-field">
            <span className="s-label">First name</span>
            <input className="s-input" name="firstName" autoComplete="given-name" required maxLength={ACCOUNT.maxNameLength} defaultValue={s.firstName} />
          </label>
          <label className="s-field">
            <span className="s-label">Last name</span>
            <input className="s-input" name="lastName" autoComplete="family-name" required maxLength={ACCOUNT.maxNameLength} defaultValue={s.lastName} />
          </label>
          <button className="s-btn s-btn-primary s-btn-block" type="submit">Continue</button>
        </form>
      </section>
    </StudentFrame>
  );
}
