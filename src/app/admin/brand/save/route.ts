import { adminPost } from "@/lib/adminPost";
import { checkBrandText, saveBrandText } from "@/lib/brand";
import { fallbackName } from "@/lib/env";

/** Name, short name, description, footer statement and default theme. */
export async function POST(request: Request) {
  return adminPost(request, "/admin/brand", async ({ db, form, actorId }) => {
    const text = checkBrandText({
      name: form.get("name"),
      shortName: form.get("shortName"),
      description: form.get("description"),
      footer: form.get("footer"),
      defaultTheme: form.get("defaultTheme"),
    });
    if (!text) return "bad_text";
    await saveBrandText(db, text, await fallbackName(), actorId);
    return "ok_saved";
  });
}
