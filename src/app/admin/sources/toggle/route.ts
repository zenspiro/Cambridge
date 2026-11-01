import { setSiteEnabled } from "@/lib/library/sources";
import { adminPost, formId } from "@/lib/adminPost";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/sources", async ({ db, form, actorId }) => {
    const id = formId(form);
    const ok = id ? await setSiteEnabled(db, id, form.get("enabled") === "1", actorId) : false;
    return ok ? "ok_changed" : "missing";
  });
}
