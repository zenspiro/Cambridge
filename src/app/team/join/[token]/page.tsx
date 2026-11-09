import type { Metadata } from "next";
import { currentBrand, getEnv } from "@/lib/env";
import { frameBrand } from "@/lib/brand";
import { accountSession } from "@/lib/account/server";
import { PARENT_THEME } from "@/lib/config";
import { StudentFrame } from "@/components/student/StudentFrame";
import { StudentNotice } from "@/components/student/Notice";
import { accessWords, openInvite } from "@/lib/auth/team";

export const metadata: Metadata = { title: "Join the team", robots: { index: false } };

const WHY = {
  unknown: "This invite link does not work. Please ask for a new one.",
  expired: "This invite has run out. Please ask for a new one.",
  used: "This invite has already been taken.",
} as const;

const MESSAGES = {
  wrong_email: "This invite is for another email address. Sign out, then sign in with the address the invite was sent to.",
  unknown: WHY.unknown,
  expired: WHY.expired,
  used: WHY.used,
};

/**
 * A team invite's page (owner, 9 Nov 2026; public: the link itself is the key). The invited person signs in with the
 * email code sign-in, using the invited address, then presses Accept. Nothing happens without that press.
 */
export default async function TeamJoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string; ref?: string }> }) {
  const { token } = await params;
  const q = await searchParams;
  const brand = await currentBrand();
  const inv = await openInvite((await getEnv()).DB, token);
  const s = inv.ok ? await accountSession() : null;
  const here = `/team/join/${token}`;
  return (
    <StudentFrame brand={frameBrand(brand)} theme={PARENT_THEME} nav={[]} current="">
      <StudentNotice messages={MESSAGES} code={q.e} errorRef={q.ref} />
      <section className="s-card s-auth" aria-label="Join the team" id="team-join">
        {!inv.ok ? (
          <>
            <h1 className="s-h1">Join the team</h1>
            <p>{WHY[inv.reason]}</p>
          </>
        ) : (
          <>
            <h1 className="s-h1">Join the {brand.name} team</h1>
            <p>{inv.name}, you are invited to help with {brand.name}&apos;s admin. Your access: {accessWords(inv.access)}.</p>
            {!s ? (
              <>
                <p>Sign in with {inv.email} to accept. You get a code by email; no password.</p>
                <a className="s-btn s-btn-primary s-btn-block" href={`/signin?next=${encodeURIComponent(here)}`}>Sign in to accept</a>
              </>
            ) : s.email.toLowerCase() !== inv.email ? (
              <>
                <p>You are signed in as {s.email}, but this invite is for {inv.email}. Sign out, then sign in with {inv.email}.</p>
                <form className="s-form" method="post" action="/account/signout">
                  <button className="s-btn s-btn-block" type="submit">Sign out</button>
                </form>
              </>
            ) : (
              <form className="s-form" method="post" action={`${here}/accept`}>
                <button className="s-btn s-btn-primary s-btn-block" type="submit">Accept and open the admin</button>
              </form>
            )}
          </>
        )}
      </section>
    </StudentFrame>
  );
}
