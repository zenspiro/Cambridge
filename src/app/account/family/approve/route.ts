import { accountPost } from "@/lib/account/post";
import { decideConsentAsParent } from "@/lib/account/profile";
import { linkApproved } from "@/lib/account/family";

/** Approve a waiting child from the parent home (the request must be addressed to this parent's email). */
export async function POST(request: Request) {
  return accountPost(request, "/parent", async ({ db, form, session }) => {
    if (!session.roles.includes("parent")) return "not_parent";
    const id = form.get("request");
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return "not_found";
    const r = await decideConsentAsParent(db, id, session.email, session.userId, "approved");
    if (!r.ok) return "not_found";
    await linkApproved(db, session.userId, session.email);
    return "ok_approved";
  });
}
