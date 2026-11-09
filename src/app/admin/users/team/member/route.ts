import { adminPost } from "@/lib/adminPost";
import { listSubjects } from "@/lib/library/catalog";
import { accessFromForm, updateMember } from "@/lib/auth/team";

// Change a team member (owner only, 9 Nov 2026): their access, pause or resume, or remove them from the team (their
// sign-in account stays; they simply have no admin access).
export async function POST(request: Request) {
  return adminPost(request, "/admin/users/team", async ({ db, form, actorId }) => {
    const userId = String(form.get("user") ?? "");
    if (!/^[A-Za-z0-9_-]{3,64}$/.test(userId)) return "bad";
    const op = form.get("op");
    if (op === "access") {
      const access = accessFromForm(form, new Set((await listSubjects(db)).map((s) => s.code)));
      return (await updateMember(db, userId, { access }, actorId)) ? "ok_saved" : "gone";
    }
    if (op === "pause" || op === "resume") return (await updateMember(db, userId, { status: op === "pause" ? "paused" : "active" }, actorId)) ? (op === "pause" ? "ok_paused" : "ok_resumed") : "gone";
    if (op === "remove") return (await updateMember(db, userId, { remove: true }, actorId)) ? "ok_removed" : "gone";
    return "bad";
  });
}
