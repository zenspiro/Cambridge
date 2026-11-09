import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { checkLibrarySettings, saveLibrarySettings } from "@/lib/settings";

export async function POST(request: Request) {
  // staffPost checks the session (owner, or a team member with the whole admin to edit) before anything else.
  return staffPost(request, "/admin/settings", ADMIN_EDIT, async ({ db, form, actorId }) => {
    const num = (k: string) => Number(String(form.get(k) ?? "").trim() || NaN);
    const value = checkLibrarySettings({
      fromYear: num("fromYear"),
      toYear: num("toYear"),
      lastSession: { year: num("lastYear"), session: form.get("lastSession") },
      essentialVariants: Object.fromEntries((["m", "s", "w"] as const).map((s) => [s, form.getAll(`ev_${s}`).map(Number)])),
    });
    if (value && Object.values(value.essentialVariants).some((v) => v.length === 0)) return "bad";
    if (!value) return "bad";
    await saveLibrarySettings(db, value, actorId);
    return "ok_saved";
  });
}
