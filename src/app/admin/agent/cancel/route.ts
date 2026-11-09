import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { formId } from "@/lib/adminPost";
import { cancelRun } from "@/lib/agent/runs";

export async function POST(request: Request) {
  // staffPost checks the session (owner, or a team member with the whole admin to edit) before anything else.
  return staffPost(request, "/admin/agent", ADMIN_EDIT, async ({ db, form, actorId }) => {
    const id = formId(form);
    if (!id) return "missing";
    await cancelRun(db, id, actorId);
    return `/admin/agent/runs/${encodeURIComponent(id)}`;
  });
}
