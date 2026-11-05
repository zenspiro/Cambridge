import { adminPost } from "@/lib/adminPost";
import { getConsentSettings, saveConsentSettings } from "@/lib/account/profile";
import { isCountry } from "@/lib/countries";

/** Takes a country back to the default age limit. */
export async function POST(request: Request) {
  return adminPost(request, "/admin/settings", async ({ db, form, actorId }) => {
    const country = form.get("country");
    if (!isCountry(country)) return "bad_age";
    const current = await getConsentSettings(db);
    const byCountry = { ...current.byCountry };
    delete byCountry[country];
    await saveConsentSettings(db, { ...current, byCountry }, actorId);
    return "ok_consent";
  });
}
