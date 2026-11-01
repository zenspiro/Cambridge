import { removeSite } from "@/lib/library/sources";
import { adminPost, formId } from "@/lib/adminPost";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/sources", async ({ db, form, actorId }) => {
    const id = formId(form);
    const ok = id ? await removeSite(db, id, actorId) : false;
    return ok ? "ok_removed" : "missing";
  });
}
