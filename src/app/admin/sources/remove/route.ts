import { removeSite } from "@/lib/library/sources";
import { formId, sourcePost } from "@/lib/library/sourceRoutes";

export async function POST(request: Request) {
  // sourcePost runs adminSession() before anything else.
  return sourcePost(request, async (db, form, actorId) => {
    const id = formId(form);
    const ok = id ? await removeSite(db, id, actorId) : false;
    return ok ? "ok_removed" : "missing";
  });
}
