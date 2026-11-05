import { THEMES } from "@/lib/config";
import { accountPost } from "@/lib/account/post";
import { saveTheme } from "@/lib/account/profile";

/** The student's own theme (look only), remembered on their account. */
export async function POST(request: Request) {
  return accountPost(request, "/me", async ({ db, form, session }) => {
    const t = THEMES.find((x) => x.id === form.get("theme"))?.id;
    if (!t) return "bad_theme";
    await saveTheme(db, session.userId, t);
    return "ok_theme";
  });
}
