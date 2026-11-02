import { adminPost, formId } from "@/lib/adminPost";
import { removeDriveFolder } from "@/lib/library/sources";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/sources", async ({ db, form, actorId }) => {
    const id = formId(form);
    return id && (await removeDriveFolder(db, id, actorId)) ? "ok_folder_removed" : "missing";
  });
}
