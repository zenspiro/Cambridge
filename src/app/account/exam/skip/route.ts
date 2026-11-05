import { accountPost } from "@/lib/account/post";
import { skipExamPrompt } from "@/lib/account/profile";

/** "Skip for now" on the student home's exam sessions question. */
export async function POST(request: Request) {
  return accountPost(request, "/student", async ({ db, session }) => {
    await skipExamPrompt(db, session.userId);
    return "ok_skipped";
  });
}
