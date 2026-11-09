import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { formId } from "@/lib/adminPost";
import { removeDriveFolder } from "@/lib/library/sources";

export async function POST(request: Request) {
  // staffPost checks the session (owner, or a team member with the whole admin to edit) before anything else.
  return staffPost(request, "/admin/sources", ADMIN_EDIT, async ({ db, form, actorId }) => {
    const id = formId(form);
    return id && (await removeDriveFolder(db, id, actorId)) ? "ok_folder_removed" : "missing";
  });
}
