import { accountPost } from "@/lib/account/post";
import { checkDetails, saveDetails, standing } from "@/lib/account/profile";
import { homeFor } from "@/lib/account/roles";

/** Country and (students) birth year, for accounts made before these were asked. Then on to wherever they belong. */
export async function POST(request: Request) {
  return accountPost(request, "/student/approval", async ({ db, form, session }) => {
    const d = checkDetails({ country: form.get("country"), birthYear: form.get("birthYear") }, session.roles.includes("student"), new Date().getUTCFullYear());
    if (!d) return "bad_details";
    await saveDetails(db, session.userId, d);
    return homeFor(session.roles, await standing(db, session.userId, session.roles));
  });
}
