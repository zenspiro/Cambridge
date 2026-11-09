import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { formId } from "@/lib/adminPost";
import { decide } from "@/lib/agent/review";

// Accept, reject or undo one "Needs your eye" file on a run page.
export async function POST(request: Request) {
  // staffPost checks the session (owner, or a team member with the whole admin to edit) before anything else.
  return staffPost(request, "/admin/agent", ADMIN_EDIT, async ({ db, form, actorId }) => {
    const id = formId(form);
    if (!id) return "missing";
    const index = Number(form.get("i"));
    const name = form.get("name");
    const out = await decide(db, { runId: id, index, action: String(form.get("action") ?? ""), name: typeof name === "string" ? name : null, actorId });
    return `/admin/agent/runs/${encodeURIComponent(id)}?r=${out}&at=${Number.isInteger(index) ? index : 0}#review`;
  });
}
