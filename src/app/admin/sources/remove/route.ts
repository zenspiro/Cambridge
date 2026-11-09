import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { removeSite } from "@/lib/library/sources";
import { formId } from "@/lib/adminPost";

export async function POST(request: Request) {
  // staffPost checks the session (owner, or a team member with the whole admin to edit) before anything else.
  return staffPost(request, "/admin/sources", ADMIN_EDIT, async ({ db, form, actorId }) => {
    const id = formId(form);
    const ok = id ? await removeSite(db, id, actorId) : false;
    return ok ? "ok_removed" : "missing";
  });
}
