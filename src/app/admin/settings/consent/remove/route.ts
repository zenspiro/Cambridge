import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { getConsentSettings, saveConsentSettings } from "@/lib/account/profile";
import { isCountry } from "@/lib/countries";

/** Takes a country back to the default age limit. */
export async function POST(request: Request) {
  return staffPost(request, "/admin/approval", ADMIN_EDIT, async ({ db, form, actorId }) => {
    const country = form.get("country");
    if (!isCountry(country)) return "bad_age";
    const current = await getConsentSettings(db);
    const byCountry = { ...current.byCountry };
    delete byCountry[country];
    await saveConsentSettings(db, { ...current, byCountry }, actorId);
    return "ok_consent";
  });
}
