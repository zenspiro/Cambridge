import { adminPost } from "@/lib/adminPost";
import { AGENT } from "@/lib/config";
import { reportError } from "@/lib/errors";
import { allow, limitKey } from "@/lib/ratelimit";
import { getLibrarySettings } from "@/lib/settings";
import { checkRunParams, finishRun, startRun } from "@/lib/agent/runs";
import { dispatchAgent } from "@/lib/agent/github";
import { listSubjects } from "@/lib/library/catalog";

export async function POST(request: Request) {
  // adminPost checks the admin session before anything else.
  return adminPost(request, "/admin/agent", async ({ db, env, form, actorId }) => {
    const params = checkRunParams(
      { code: form.get("code"), years: form.getAll("years"), sessions: form.getAll("sessions"), mode: form.get("mode") },
      await getLibrarySettings(db),
      (await listSubjects(db)).map((s) => s.code),
    );
    if (!params) return "bad";
    if (!(await allow(db, await limitKey("agent-run", actorId), AGENT.runsPerHour, 3_600_000))) return "busy";
    const id = await startRun(db, params, actorId);
    if (!id) return "running";

    let failure: string | null = null;
    try {
      const d = await dispatchAgent(env, id);
      if (!d.ok) failure = d.reason === "not_set_up" ? "not_set_up" : `github_${d.status ?? "error"}`;
    } catch (err) {
      failure = "github_unreachable";
      reportError("agent.dispatch", err);
    }
    if (failure) {
      if (failure !== "not_set_up") reportError("agent.dispatch", new Error(failure));
      await finishRun(db, id, false, JSON.stringify({ error: failure }), failure);
    }
    return `/admin/agent/runs/${encodeURIComponent(id)}`;
  });
}
