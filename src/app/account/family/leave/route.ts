import { accountPost } from "@/lib/account/post";
import { leaveFamily } from "@/lib/account/family";

/** A student over the age limit leaves their parent's family. */
export async function POST(request: Request) {
  return accountPost(request, "/me", async ({ db, session }) => leaveFamily(db, session.userId));
}
