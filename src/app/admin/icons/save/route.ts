import { adminPost } from "@/lib/adminPost";
import { saveIcon } from "@/lib/icons";

// Settings > Icons (owner, 9 Nov 2026): choose a place's icon from the set, or put its default back (`to=default`).
export async function POST(request: Request) {
  return adminPost(request, "/admin/icons", async ({ db, form, actorId }) => {
    const slot = String(form.get("slot") ?? "");
    // "to=default" (a field named "reset" would hide the form's own reset()).
    const reset = form.get("to") === "default";
    const name = reset ? null : String(form.get("name") ?? "");
    return (await saveIcon(db, slot, name, actorId)) ? (reset ? "ok_reset" : "ok_saved") : "bad";
  });
}
