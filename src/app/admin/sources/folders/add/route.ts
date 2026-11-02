import { adminPost, formId } from "@/lib/adminPost";
import { addDriveFolders } from "@/lib/library/sources";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/sources", async ({ db, form, actorId }) => {
    const site = formId(form, "site");
    if (!site) return "missing";
    const r = await addDriveFolders(db, site, form.get("links"), actorId);
    if (!r.ok) return r.error;
    return `/admin/sources?e=${r.added ? "ok_folders" : r.dupes ? "folder_exists" : "folder_bad"}&added=${r.added}&dupes=${r.dupes}&bad=${r.bad}`;
  });
}
