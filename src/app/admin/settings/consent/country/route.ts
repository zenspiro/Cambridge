import { adminPost } from "@/lib/adminPost";
import { checkConsentSettings, getConsentSettings, saveConsentSettings } from "@/lib/account/profile";

/** A country whose age limit differs from the default (adding it again changes it). */
export async function POST(request: Request) {
  return adminPost(request, "/admin/approval", async ({ db, form, actorId }) => {
    const current = await getConsentSettings(db);
    const country = String(form.get("country") ?? "");
    const v = checkConsentSettings({ ...current, byCountry: { ...current.byCountry, [country]: Number(form.get("age")) } });
    if (!v) return "bad_age";
    await saveConsentSettings(db, v, actorId);
    return "ok_consent";
  });
}
