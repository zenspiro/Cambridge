import { adminPost } from "@/lib/adminPost";
import { BRAIN } from "@/lib/config";
import { reportError } from "@/lib/errors";
import { allow, limitKey } from "@/lib/ratelimit";
import { dispatchBrain } from "@/lib/agent/github";
import { failBrainRun, startCheckRun } from "@/lib/brain/runs";

// "Check Claude" / "Check Gemini": a brain run on GitHub that lists the models the key can use and tries them.
export async function POST(request: Request) {
  return adminPost(request, "/admin/ai", async ({ db, env, form, actorId }) => {
    const w = form.get("which");
    const which = w === "claude" || w === "gemini" ? w : null;
    if (!(await allow(db, await limitKey("brain-run", actorId), BRAIN.runsPerHour, 3_600_000))) return "busy";
    const jobId = await startCheckRun(db, actorId, which);
    if (!jobId) return "running";
    let failure: string | null = null;
    try {
      const d = await dispatchBrain(env, jobId);
      if (!d.ok) failure = d.reason === "not_set_up" ? "not_set_up" : `github_${d.status ?? "error"}`;
    } catch (err) {
      failure = "github_unreachable";
      reportError("brain.dispatch", err);
    }
    if (failure) {
      if (failure !== "not_set_up") reportError("brain.dispatch", new Error(failure));
      await failBrainRun(db, jobId, failure);
      return failure === "not_set_up" ? "not_set_up" : "github";
    }
    return "ok_started";
  });
}
