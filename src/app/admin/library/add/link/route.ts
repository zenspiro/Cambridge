import { addFilePost } from "@/lib/library/addFile";
import { fetchApprovedPdf } from "@/lib/library/fetchLink";
import { storeDocument } from "@/lib/library/store";

// One missing file fetched from a link on an approved source, saved under the checklist's name.
export async function POST(request: Request) {
  // addFilePost runs staffPost, which checks the owner or a team member with library edit before anything else.
  return addFilePost(request, async ({ db, env, form, actorId, target }) => {
    const got = await fetchApprovedPdf(db, form.get("url"));
    if (!got.ok) return got;
    const out = await storeDocument(db, env.SOURCE, {
      fileName: target, bytes: got.bytes, actorId, origin: "link", sourceUrl: got.url, sourceSiteId: got.siteId,
    });
    return out.ok ? { ok: true } : { ok: false, reason: out.reason };
  });
}
