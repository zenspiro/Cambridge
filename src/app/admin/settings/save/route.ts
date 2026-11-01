import { adminPost } from "@/lib/adminPost";
import { checkLibrarySettings, saveLibrarySettings } from "@/lib/settings";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/settings", async ({ db, form, actorId }) => {
    const num = (k: string) => Number(String(form.get(k) ?? "").trim() || NaN);
    const value = checkLibrarySettings({
      fromYear: num("fromYear"),
      toYear: num("toYear"),
      lastSession: { year: num("lastYear"), session: form.get("lastSession") },
    });
    if (!value) return "bad";
    await saveLibrarySettings(db, value, actorId);
    return "ok_saved";
  });
}
