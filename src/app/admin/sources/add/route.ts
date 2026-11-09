import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { addSite } from "@/lib/library/sources";

export async function POST(request: Request) {
  // staffPost checks the session (owner, or a team member with the whole admin to edit) before anything else.
  return staffPost(request, "/admin/sources", ADMIN_EDIT, async ({ db, form, actorId }) => {
    const r = await addSite(db, { name: form.get("name"), url: form.get("url"), notes: form.get("notes") }, actorId);
    return r.ok ? "ok_added" : r.error;
  });
}
