import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { setSiteEnabled } from "@/lib/library/sources";
import { formId } from "@/lib/adminPost";

export async function POST(request: Request) {
  // staffPost checks the session (owner, or a team member with the whole admin to edit) before anything else.
  return staffPost(request, "/admin/sources", ADMIN_EDIT, async ({ db, form, actorId }) => {
    const id = formId(form);
    const ok = id ? await setSiteEnabled(db, id, form.get("enabled") === "1", actorId) : false;
    return ok ? "ok_changed" : "missing";
  });
}
