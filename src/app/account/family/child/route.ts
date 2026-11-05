import { FAMILY } from "@/lib/config";
import { accountPost } from "@/lib/account/post";
import { createChild } from "@/lib/account/family";
import { checkDetails } from "@/lib/account/profile";
import { checkNames, cleanEmail } from "@/lib/account/roles";
import { allow, limitKey } from "@/lib/ratelimit";

/** The parent makes a student account with the child's own email (counted as approved). */
export async function POST(request: Request) {
  return accountPost(request, "/parent", async ({ db, form, session }) => {
    if (!session.roles.includes("parent")) return "not_parent";
    const n = checkNames({ firstName: form.get("firstName"), lastName: form.get("lastName") });
    const email = cleanEmail(form.get("email"));
    const d = checkDetails({ country: form.get("country"), birthYear: form.get("birthYear") }, true, new Date().getUTCFullYear());
    if (!n || !email || !d || d.birthYear === null) return "bad_child";
    if (email === session.email.toLowerCase()) return "bad_child";
    if (!(await allow(db, await limitKey("family-create", session.userId), FAMILY.childAccountsPerDay, 86_400_000))) return "busy";
    return createChild(db, session.userId, { ...n, email, birthYear: d.birthYear, country: d.country });
  });
}
