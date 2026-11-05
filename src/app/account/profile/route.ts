import { accountPost } from "@/lib/account/post";
import { checkNames, saveNames } from "@/lib/account/roles";
import { checkDetails, saveDetails } from "@/lib/account/profile";

/** "Me": first and last name, country and (students, until a parent approved) birth year. */
export async function POST(request: Request) {
  return accountPost(request, "/me", async ({ db, form, session }) => {
    const n = checkNames({ firstName: form.get("firstName"), lastName: form.get("lastName") });
    const student = session.roles.includes("student");
    const by = form.get("birthYear");
    const d = checkDetails({ country: form.get("country"), birthYear: by }, student && by !== null, new Date().getUTCFullYear());
    if (!n || !d) return "bad_details";
    await saveNames(db, session.userId, n);
    await saveDetails(db, session.userId, d);
    return "ok_saved";
  });
}
