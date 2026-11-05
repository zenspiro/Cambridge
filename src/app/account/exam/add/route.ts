import { accountPost } from "@/lib/account/post";
import { checkExamPlan, saveExamPlan } from "@/lib/account/profile";
import { listSubjects } from "@/lib/library/catalog";

/** One exam session per subject (adding a subject again changes its session). */
export async function POST(request: Request) {
  return accountPost(request, "/me", async ({ db, form, session }) => {
    const codes = (await listSubjects(db)).map((s) => s.code);
    const e = checkExamPlan({ code: form.get("code"), session: form.get("session"), year: form.get("year") }, codes, new Date().getUTCFullYear());
    if (!e) return "bad_exam";
    await saveExamPlan(db, session.userId, e);
    return "ok_exam";
  });
}
