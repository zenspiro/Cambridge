import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentBrand } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { accountSession, accountsReady, googleReady } from "@/lib/account/server";
import { homeFor, safeNext } from "@/lib/account/roles";
import { TEAM } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";
import { SignIn } from "@/components/student/SignIn";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Readonly<Record<string, { good: boolean; text: string }>> = {
  ok_out: { good: true, text: "You are signed out." },
  ok_deleted: { good: true, text: "Your account and everything in it has been deleted." },
  google: { good: false, text: "Google sign-in did not finish. Please try again, or use an email code." },
  google_off: { good: false, text: "Google sign-in is not open yet. Please use an email code." },
};

/** Sign-in for students and parents (public). Already signed in: straight to their home. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const q = await searchParams;
  // `next`: a team member signing in for the admin, or someone taking a team invite (owner, 9 Nov 2026).
  const next = safeNext(q.next);
  const s = await accountSession();
  // Team access needs a sign-in from the last TEAM.sessionMs: an older one signs in again here.
  if (s && !(next === "/admin" && Date.now() - s.signedInAt > TEAM.sessionMs)) redirect(next ?? homeFor(s.roles, s.standing));
  const brand = await currentBrand();
  const e = q.e;
  const notice = e && Object.hasOwn(NOTICES, e) ? NOTICES[e] : null;
  const ready = await accountsReady();
  return (
    <StudentFrame brand={frameBrand(brand)} theme={brand.defaultTheme} nav={[]} current="">
      {notice ? <p className={notice.good ? "s-note s-note-good" : "s-note s-note-bad"} role="status">{notice.text}</p> : null}
      {ready ? <SignIn google={await googleReady() && !next} next={next} /> : (
        <section className="s-card s-auth">
          <h1 className="s-h1">Sign in</h1>
          <p>Sign-in is not open yet. Please try again later.</p>
        </section>
      )}
    </StudentFrame>
  );
}
