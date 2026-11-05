import { FAMILY } from "@/lib/config";
import { accountPost } from "@/lib/account/post";
import { joinByCode } from "@/lib/account/family";
import { allow, limitKey } from "@/lib/ratelimit";

/** A student types their parent's family code on Me. Tries are limited, so codes cannot be guessed. */
export async function POST(request: Request) {
  return accountPost(request, "/me", async ({ db, form, session }) => {
    if (!(await allow(db, await limitKey("family-join", session.userId), FAMILY.joinTriesPerHour, 3_600_000))) return "busy";
    return joinByCode(db, session.userId, form.get("code"));
  });
}
