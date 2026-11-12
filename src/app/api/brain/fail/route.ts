import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { failBrainRun } from "@/lib/brain/runs";
import { startQueued } from "@/lib/brain/queue";

// The brain script could not finish (a model or key problem): the run closes with a fixed reason code.
export async function POST(request: Request) {
  const a = await agentRequest(request, 8 * 1024);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  const reason = typeof b?.reason === "string" && /^[a-z0-9_]{2,60}$/.test(b.reason) ? b.reason : "script_error";
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  if (!(await failBrainRun(a.db, jobId, reason))) return json({ error: "no_run" }, 409);
  // The next run in the queue starts, unless this stop would stop it too (the queue then waits; owner, 12 Nov 2026).
  await startQueued(a.db, a.env, { lastStop: reason });
  return json({ ok: true });
}
