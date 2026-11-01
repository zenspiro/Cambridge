import { addFilePost } from "@/lib/library/addFile";
import { storeDocument } from "@/lib/library/store";

// One missing file from the admin's computer, saved under the checklist's file name.
export async function POST(request: Request) {
  // addFilePost runs adminPost, which checks the admin session before anything else.
  return addFilePost(request, async ({ db, env, form, actorId, target }) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, reason: "none" };
    const out = await storeDocument(db, env.SOURCE, {
      fileName: target, bytes: new Uint8Array(await file.arrayBuffer()), actorId, origin: "upload",
    });
    return out.ok ? { ok: true } : { ok: false, reason: out.reason };
  });
}
