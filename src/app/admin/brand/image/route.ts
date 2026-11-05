import { adminPost } from "@/lib/adminPost";
import { IMAGE_KINDS, saveBrandImage } from "@/lib/brand";
import { BRAND, type BrandImageKind } from "@/lib/config";
import { fallbackName } from "@/lib/env";

/** One brand image (logo, square logo or favicon): PNG, JPEG or WebP, checked by its bytes. */
export async function POST(request: Request) {
  return adminPost(request, "/admin/brand", async ({ db, env, form, actorId }) => {
    const kind = form.get("kind");
    if (typeof kind !== "string" || !IMAGE_KINDS.includes(kind as BrandImageKind)) return "bad_kind";
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return "empty";
    if (file.size > BRAND.maxImageBytes) return "too_big";
    const bytes = new Uint8Array(await file.arrayBuffer());
    return saveBrandImage(db, env.FILES, kind as BrandImageKind, bytes, await fallbackName(), actorId);
  });
}
