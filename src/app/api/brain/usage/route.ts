import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { activeBrainRun } from "@/lib/brain/runs";
import { cleanUsage, recordSpend } from "@/lib/brain/spend";

// The tokens one Claude or Gemini question used, as the service reported them (for the AI usage dashboard and the
// monthly cap). Signed only, a running brain run only; the job is counted under the run's own task.
export async function POST(request: Request) {
  const a = await agentRequest(request, 4 * 1024);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params) return json({ error: "no_run" }, 409);
  const entry = cleanUsage(b?.usage);
  if (!entry) return json({ error: "bad_request" }, 400);
  // A paper run's figure drawings count as their own job ("Drawing figures").
  const task = params.task === "paper" && b?.task === "drawing" ? "drawing" : params.task;
  await recordSpend(a.db, jobId, task, entry);
  return json({ ok: true });
}
