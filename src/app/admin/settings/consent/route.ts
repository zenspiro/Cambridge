import { adminPost } from "@/lib/adminPost";
import { checkConsentSettings, getConsentSettings, saveConsentSettings } from "@/lib/account/profile";

/** The default age limit for parent approval. */
export async function POST(request: Request) {
  return adminPost(request, "/admin/approval", async ({ db, form, actorId }) => {
    const current = await getConsentSettings(db);
    const v = checkConsentSettings({ ...current, defaultAge: Number(form.get("defaultAge")) });
    if (!v) return "bad_age";
    await saveConsentSettings(db, v, actorId);
    return "ok_consent";
  });
}
