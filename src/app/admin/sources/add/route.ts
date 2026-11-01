import { addSite } from "@/lib/library/sources";
import { adminPost } from "@/lib/adminPost";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/sources", async ({ db, form, actorId }) => {
    const r = await addSite(db, { name: form.get("name"), url: form.get("url"), notes: form.get("notes") }, actorId);
    return r.ok ? "ok_added" : r.error;
  });
}
