import { adminPost } from "@/lib/adminPost";
import { chooseModel } from "@/lib/brain/aiSetup";

// Use this model: Claude from Anthropic's list for the key, Gemini only one the last check found working.
export async function POST(request: Request) {
  return adminPost(request, "/admin/ai", async ({ db, form, actorId }) => chooseModel(db, form.get("provider"), form.get("model"), actorId));
}
