import { CONSENT } from "@/lib/config";
import { accountPost } from "@/lib/account/post";
import { cleanEmail } from "@/lib/account/roles";
import { consentEmail, sendEmail } from "@/lib/account/email";
import { createConsent } from "@/lib/account/profile";
import { isLocalHost, originOf } from "@/lib/account/server";
import { currentBrand } from "@/lib/env";
import { allow, limitKey } from "@/lib/ratelimit";
import { reportError } from "@/lib/errors";

/** A waiting student asks a parent: a new one-tap link by email (any older link stops working). */
export async function POST(request: Request) {
  return accountPost(request, "/student/approval", async ({ db, env, form, session }) => {
    if (session.standing !== "pending") return "not_needed";
    const parent = cleanEmail(form.get("parentEmail"));
    if (!parent) return "bad_email";
    if (parent === session.email.toLowerCase()) return "same_email";
    const day = 86_400_000;
    const a = await allow(db, await limitKey("consent-student", session.userId), CONSENT.sendsPerStudentPerDay, day);
    const b = await allow(db, await limitKey("consent-parent", parent), CONSENT.sendsPerParentEmailPerDay, day);
    if (!a || !b) return "busy";
    const token = await createConsent(db, session.userId, parent);
    const origin = originOf(request.headers);
    const brand = await currentBrand();
    const msg = consentEmail(brand.name, parent, `${session.firstName} ${session.lastName}`.trim(), `${origin}/consent/${token}`, CONSENT.linkDays);
    const sent = await sendEmail(msg, { platform: brand.name, from: brand.emailFrom, apiKey: env.RESEND, local: env.EMAIL_TRANSPORT === "local" && isLocalHost(origin), bucket: env.FILES });
    if (sent !== "sent") {
      reportError("consent.send", new Error(`approval email not sent: ${sent}`));
      return "not_sent";
    }
    return "ok_sent";
  });
}
