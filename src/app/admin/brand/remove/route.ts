import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { IMAGE_KINDS, removeBrandImage } from "@/lib/brand";
import type { BrandImageKind } from "@/lib/config";
import { fallbackName } from "@/lib/env";

/** Takes one brand image away (the platform name shows as text again). */
export async function POST(request: Request) {
  return staffPost(request, "/admin/brand", ADMIN_EDIT, async ({ db, env, form, actorId }) => {
    const kind = form.get("kind");
    if (typeof kind !== "string" || !IMAGE_KINDS.includes(kind as BrandImageKind)) return "bad_kind";
    await removeBrandImage(db, env.FILES, kind as BrandImageKind, await fallbackName(), actorId);
    return "ok_removed";
  });
}
