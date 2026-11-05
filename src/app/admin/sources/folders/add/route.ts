import { adminPost, formId } from "@/lib/adminPost";
import { addDriveFolders } from "@/lib/library/sources";
import { listSubjects } from "@/lib/library/catalog";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/sources", async ({ db, form, actorId }) => {
    const site = formId(form, "site");
    if (!site) return "missing";
    // Added from a subject's card: the folder is labelled with that subject ("IGCSE Physics (0625)").
    const code = form.get("code");
    const label = typeof code === "string" && code ? (await listSubjects(db)).find((s) => s.code === code)?.label ?? "" : "";
    const r = await addDriveFolders(db, site, form.get("links"), actorId, Date.now(), label);
    if (!r.ok) return r.error;
    return `/admin/sources?e=${r.added ? "ok_folders" : r.dupes ? "folder_exists" : "folder_bad"}&added=${r.added}&dupes=${r.dupes}&bad=${r.bad}`;
  });
}
