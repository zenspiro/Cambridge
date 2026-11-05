import { accountPost } from "@/lib/account/post";
import { removeChild } from "@/lib/account/family";

/** Takes a child out of the family (their account stays). */
export async function POST(request: Request) {
  return accountPost(request, "/parent", async ({ db, form, session }) => {
    const child = form.get("child");
    if (typeof child !== "string" || !(await removeChild(db, session.userId, child))) return "not_found";
    return "ok_removed";
  });
}
