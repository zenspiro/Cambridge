import { brandKey, findBrandImage } from "@/lib/brand";
import { currentBrand, getEnv } from "@/lib/env";
import { reportError } from "@/lib/errors";

/**
 * Public brand images (logo, square logo, favicon). Only the current file of each kind is served; its name carries
 * a hash of its bytes, so it can be cached for a year and a new upload gets a new address.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  try {
    const img = findBrandImage(await currentBrand(), file);
    if (!img) return new Response("Not found", { status: 404 });
    const obj = await (await getEnv()).FILES.get(brandKey(img.file));
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, {
      headers: {
        "Content-Type": img.type,
        "Content-Length": String(obj.size),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      },
    });
  } catch (err) {
    reportError("brand.image", err);
    return new Response("Not available", { status: 503 });
  }
}
