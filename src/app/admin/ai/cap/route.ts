import { adminPost } from "@/lib/adminPost";
import { saveCap } from "@/lib/brain/spend";

// The monthly spending cap in US dollars; empty or 0 means no cap.
export async function POST(request: Request) {
  return adminPost(request, "/admin/ai", async ({ db, form, actorId }) => saveCap(db, form.get("cap"), actorId));
}
