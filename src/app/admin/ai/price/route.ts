import { adminPost } from "@/lib/adminPost";
import { savePrice } from "@/lib/brain/spend";

// One model's prices (US dollars per million tokens, in and out); both boxes empty removes the price.
export async function POST(request: Request) {
  return adminPost(request, "/admin/ai", async ({ db, form, actorId }) => savePrice(db, form.get("model"), form.get("in"), form.get("out"), actorId));
}
