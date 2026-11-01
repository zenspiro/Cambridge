import { adminPost, formId } from "@/lib/adminPost";
import { cancelRun } from "@/lib/agent/runs";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/agent", async ({ db, form, actorId }) => {
    const id = formId(form);
    if (!id) return "missing";
    await cancelRun(db, id, actorId);
    return `/admin/agent/runs/${encodeURIComponent(id)}`;
  });
}
