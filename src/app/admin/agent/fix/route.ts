import { adminPost, formId } from "@/lib/adminPost";
import { readReport } from "@/lib/agent/labels";
import { getRun } from "@/lib/agent/runs";
import { removeDocument, renameDocument } from "@/lib/library/store";

// Library check: rename a stored file to what its first page says, or remove it. The file is
// read from the run's report by its position, never from the form.
export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/agent", async ({ db, env, form, actorId }) => {
    const id = formId(form);
    if (!id) return "missing";
    const i = Number(form.get("i"));
    const action = form.get("action");
    const back = (r: string) => `/admin/agent/runs/${encodeURIComponent(id)}?f=${r}&at=${Number.isInteger(i) ? i : 0}#check`;
    const run = await getRun(db, id);
    const item = run && JSON.parse(run.params).mode === "check" && !["queued", "running"].includes(run.status) && Number.isInteger(i) && i >= 0 && i < 300
      ? readReport(run.result).check?.items?.[i]
      : undefined;
    if (!item || typeof item.id !== "string") return back("gone");
    if (action === "rename" && typeof item.coverName === "string") return back(await renameDocument(db, env.SOURCE, item.id, item.coverName, actorId));
    if (action === "remove") return back(await removeDocument(db, env.SOURCE, item.id, actorId));
    return back("gone");
  });
}
