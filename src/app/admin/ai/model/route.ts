import { adminPost } from "@/lib/adminPost";
import { chooseGemini } from "@/lib/brain/aiSetup";

// Use this Gemini model: only one the last check found working.
export async function POST(request: Request) {
  return adminPost(request, "/admin/ai", async ({ db, form, actorId }) => chooseGemini(db, form.get("model"), actorId));
}
