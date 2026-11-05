import { accountPost } from "@/lib/account/post";
import { removeExamPlan } from "@/lib/account/profile";

export async function POST(request: Request) {
  return accountPost(request, "/me", async ({ db, form, session }) => {
    const code = form.get("code");
    if (typeof code !== "string" || !/^\d{4}$/.test(code)) return "bad_exam";
    await removeExamPlan(db, session.userId, code);
    return "ok_removed";
  });
}
