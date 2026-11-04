import { adminPost, formId } from "@/lib/adminPost";
import { decide } from "@/lib/agent/review";

// Accept, reject or undo one "Needs your eye" file on a run page.
export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/agent", async ({ db, form, actorId }) => {
    const id = formId(form);
    if (!id) return "missing";
    const index = Number(form.get("i"));
    const name = form.get("name");
    const out = await decide(db, { runId: id, index, action: String(form.get("action") ?? ""), name: typeof name === "string" ? name : null, actorId });
    return `/admin/agent/runs/${encodeURIComponent(id)}?r=${out}&at=${Number.isInteger(index) ? index : 0}#review`;
  });
}
