import { adminPost } from "@/lib/adminPost";
import { listSubjects } from "@/lib/library/catalog";
import { accessFromForm, createInvite } from "@/lib/auth/team";
import { sendInvite } from "@/lib/auth/teamMail";

// Invite someone to the team (owner only, 9 Nov 2026): name, email, access per area and subjects. A one-time link by
// email; an older pending invite to the same address stops working.
export async function POST(request: Request) {
  return adminPost(request, "/admin/users/team", async ({ db, env, form, actorId }) => {
    const known = new Set((await listSubjects(db)).map((s) => s.code));
    const access = accessFromForm(form, known);
    const r = await createInvite(db, form.get("email"), form.get("name"), access, actorId);
    if (!r.ok) return r.reason;
    const inv = await db.prepare(`SELECT email, name FROM team_invite WHERE id = ?1`).bind(r.id).first<{ email: string; name: string }>();
    const sent = await sendInvite(request, env, inv!.email, inv!.name, access, r.token);
    return sent === "sent" ? "ok_invited" : `mail_${sent}`;
  });
}
