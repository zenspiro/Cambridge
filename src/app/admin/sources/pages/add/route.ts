import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { formId } from "@/lib/adminPost";
import { addPage } from "@/lib/library/sources";

export async function POST(request: Request) {
  // staffPost checks the session (owner, or a team member with the whole admin to edit) before anything else.
  return staffPost(request, "/admin/sources", ADMIN_EDIT, async ({ db, form, actorId }) => {
    const siteId = formId(form, "site");
    if (!siteId) return "missing";
    const r = await addPage(db, { siteId, url: form.get("url"), code: form.get("code") }, actorId);
    return r.ok ? "ok_page" : r.error;
  });
}
