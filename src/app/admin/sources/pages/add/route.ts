import { adminPost, formId } from "@/lib/adminPost";
import { addPage } from "@/lib/library/sources";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/sources", async ({ db, form, actorId }) => {
    const siteId = formId(form, "site");
    if (!siteId) return "missing";
    const r = await addPage(db, { siteId, url: form.get("url"), code: form.get("code") }, actorId);
    return r.ok ? "ok_page" : r.error;
  });
}
