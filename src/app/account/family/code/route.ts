import { accountPost } from "@/lib/account/post";
import { makeCode } from "@/lib/account/family";

/** A new family code for the parent (the old one stops working). */
export async function POST(request: Request) {
  return accountPost(request, "/parent", async ({ db, session }) => {
    if (!session.roles.includes("parent")) return "not_parent";
    await makeCode(db, session.userId);
    return "ok_code";
  });
}
