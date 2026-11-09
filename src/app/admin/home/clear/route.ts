import { adminPost } from "@/lib/adminPost";
import { audit } from "@/lib/auth/session";
import { clearNeed } from "@/lib/adminStatus";

const ID_RE = /^[A-Za-z0-9_-]{3,64}$/;

// Needs you on Home (owner, 9 Nov 2026): Clear one item, Clear all of a section, or Undo a clear. It only hides the
// item from Home; the run's page and the paper's flags stay as they are.
export async function POST(request: Request) {
  return adminPost(request, "/admin", async ({ db, form, actorId }) => {
    const kind = form.get("kind");
    const id = String(form.get("id") ?? "");
    const undo = form.get("undo") === "1";
    if ((kind !== "run" && kind !== "paper") || (id !== "all" && !ID_RE.test(id)) || (undo && id === "all")) return "bad";
    const n = await clearNeed(db, kind, id, undo);
    if (!n) return "gone";
    await audit(db, { actorId, action: undo ? "home.undo" : id === "all" ? "home.clear_all" : "home.clear", entity: kind === "run" ? "job" : "source_document", entityId: id === "all" ? null : id, detail: { kind, items: n } });
    return undo ? "ok_back" : "ok_cleared";
  });
}
