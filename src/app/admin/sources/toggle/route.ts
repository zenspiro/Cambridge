import { setSiteEnabled } from "@/lib/library/sources";
import { formId, sourcePost } from "@/lib/library/sourceRoutes";

export async function POST(request: Request) {
  // sourcePost runs adminSession() before anything else.
  return sourcePost(request, async (db, form, actorId) => {
    const id = formId(form);
    const ok = id ? await setSiteEnabled(db, id, form.get("enabled") === "1", actorId) : false;
    return ok ? "ok_changed" : "missing";
  });
}
