import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { startQueued, unqueue } from "@/lib/brain/queue";

// The run queue on the Read all card (owner, 12 Nov 2026): Remove one waiting ask, or Start now (a held queue: the
// first ask starts if no run is going on). The ask is found by its id in the stored queue, never read from the form.
export async function POST(request: Request) {
  return staffPost(request, "/admin/library", ADMIN_EDIT, async ({ db, env, form, actorId }) => {
    const code = String(form.get("code") ?? "");
    const base = /^[0-9]{4}$/.test(code) ? `/admin/library/${code}` : "/admin/library";
    const back = (e: string) => `${base}?e=${e}#read-all`;
    const id = String(form.get("id") ?? "");
    if (form.get("do") === "remove") return back((await unqueue(db, id, actorId)) ? "ok_unqueued" : "bad");
    if (form.get("do") === "start") {
      const r = await startQueued(db, env, { force: true });
      return back(r === "empty" ? "queue_empty" : r === "ok_batch" ? "ok_batch" : r);
    }
    return back("bad");
  });
}
