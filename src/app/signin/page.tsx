import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentBrand } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { accountSession, accountsReady, googleReady } from "@/lib/account/server";
import { homeFor } from "@/lib/account/roles";
import { StudentFrame } from "@/components/student/StudentFrame";
import { SignIn } from "@/components/student/SignIn";

export const metadata: Metadata = { title: "Sign in" };

const NOTICES: Readonly<Record<string, { good: boolean; text: string }>> = {
  ok_out: { good: true, text: "You are signed out." },
  google: { good: false, text: "Google sign-in did not finish. Please try again, or use an email code." },
  google_off: { good: false, text: "Google sign-in is not open yet. Please use an email code." },
};

/** Sign-in for students and parents (public). Already signed in: straight to their home. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const s = await accountSession();
  if (s) redirect(homeFor(s.roles));
  const brand = await currentBrand();
  const e = (await searchParams).e;
  const notice = e && Object.hasOwn(NOTICES, e) ? NOTICES[e] : null;
  const ready = await accountsReady();
  return (
    <StudentFrame brand={frameBrand(brand)} theme={brand.defaultTheme} nav={[]} current="">
      {notice ? <p className={notice.good ? "s-note s-note-good" : "s-note s-note-bad"} role="status">{notice.text}</p> : null}
      {ready ? <SignIn google={await googleReady()} /> : (
        <section className="s-card s-auth">
          <h1 className="s-h1">Sign in</h1>
          <p>Sign-in is not open yet. Please try again later.</p>
        </section>
      )}
    </StudentFrame>
  );
}
