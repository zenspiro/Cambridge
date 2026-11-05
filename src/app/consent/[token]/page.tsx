import type { Metadata } from "next";
import { currentBrand, getEnv } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { openConsent } from "@/lib/account/profile";
import { PARENT_THEME } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";
import { StudentNotice } from "@/components/student/Notice";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

export const metadata: Metadata = { title: "Parent approval", robots: { index: false } };

const WHY = {
  unknown: "This link does not work. Please ask your child to send a new one.",
  expired: "This link has run out. Please ask your child to send a new one.",
  used: "This request has already been answered. Thank you.",
} as const;

/** The page a parent's email link opens (public: the link itself is the key). Answering needs a button press. */
export default async function ConsentPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ ref?: string }> }) {
  const { token } = await params;
  const q = await searchParams;
  const brand = await currentBrand();
  const link = await openConsent((await getEnv()).DB, token);
  return (
    <StudentFrame brand={frameBrand(brand)} theme={PARENT_THEME} nav={[]} current="">
      <StudentNotice messages={{}} errorRef={q.ref} />
      <section className="s-card s-auth" aria-label="Parent approval">
        {link.ok ? (
          <>
            <h1 className="s-h1">Approve {link.firstName} {link.lastName}&apos;s account?</h1>
            <p>{link.firstName} wants to use {brand.name} to practise for Cambridge exams and gave {link.parentEmail} as their parent or guardian.</p>
            <p className="s-muted">We keep only what the app needs: their name, email, country and birth year, and their practice. No ads, and nothing is sold. You can ask us to delete it at any time.</p>
            <form className="s-form" method="post" action={`/consent/${token}/answer`}>
              <input type="hidden" name="answer" value="approved" />
              <button className="s-btn s-btn-primary s-btn-block" type="submit">Approve</button>
            </form>
            <form className="s-form" method="post" action={`/consent/${token}/answer`}>
              <input type="hidden" name="answer" value="declined" />
              <ConfirmSubmit className="s-btn s-btn-danger" label="Decline" question={`Decline and delete ${link.firstName}'s account?`} yes="Yes, decline" />
            </form>
          </>
        ) : (
          <>
            <h1 className="s-h1">Parent approval</h1>
            <p>{WHY[link.reason]}</p>
          </>
        )}
      </section>
    </StudentFrame>
  );
}
