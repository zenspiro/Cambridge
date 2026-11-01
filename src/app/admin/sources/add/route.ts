import { addSite } from "@/lib/library/sources";
import { sourcePost } from "@/lib/library/sourceRoutes";

export async function POST(request: Request) {
  // sourcePost runs adminSession() before anything else.
  return sourcePost(request, async (db, form, actorId) => {
    const r = await addSite(db, { name: form.get("name"), url: form.get("url"), notes: form.get("notes") }, actorId);
    return r.ok ? "ok_added" : r.error;
  });
}
