import { adminPost, formId } from "@/lib/adminPost";
import { cleanAccess, createInvite } from "@/lib/auth/team";
import { sendInvite } from "@/lib/auth/teamMail";

// Send a pending invite again (owner only): a new link with the same access; the old link stops working.
export async function POST(request: Request) {
  return adminPost(request, "/admin/users/team", async ({ db, env, form, actorId }) => {
    const id = formId(form);
    const inv = id ? await db.prepare(`SELECT email, name, access FROM team_invite WHERE id = ?1 AND status = 'pending'`).bind(id).first<{ email: string; name: string; access: string }>() : null;
    if (!inv) return "gone";
    const access = cleanAccess(JSON.parse(inv.access));
    const r = await createInvite(db, inv.email, inv.name, access, actorId);
    if (!r.ok) return r.reason;
    const sent = await sendInvite(request, env, inv.email, inv.name, access, r.token);
    return sent === "sent" ? "ok_invited" : `mail_${sent}`;
  });
}
