import { adminPost, formId } from "@/lib/adminPost";
import { cancelInvite } from "@/lib/auth/team";

// Cancel a pending team invite (owner only): its link stops working.
export async function POST(request: Request) {
  return adminPost(request, "/admin/users/team", async ({ db, form, actorId }) => {
    const id = formId(form);
    return id && (await cancelInvite(db, id, actorId)) ? "ok_cancelled" : "gone";
  });
}
