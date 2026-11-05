import { accountPost } from "@/lib/account/post";
import { isMyChild } from "@/lib/account/family";
import { deleteAccount } from "@/lib/account/profile";

/** The parent deletes a child's account and everything in it (inline confirm on the page). */
export async function POST(request: Request) {
  return accountPost(request, "/parent", async ({ db, form, session }) => {
    const child = form.get("child");
    if (typeof child !== "string" || !(await isMyChild(db, session.userId, child))) return "not_found";
    await deleteAccount(db, child, session.userId);
    return "ok_deleted";
  });
}
