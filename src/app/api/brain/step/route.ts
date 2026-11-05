import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { brainStep } from "@/lib/brain/runs";

// The brain script's sign of life and current step in plain words. Signed only. 409: the run was closed.
export async function POST(request: Request) {
  const a = await agentRequest(request, 8 * 1024);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  const step = typeof b?.step === "string" ? b.step.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId) || !step) return json({ error: "bad_request" }, 400);
  return (await brainStep(a.db, jobId, step)) ? json({ ok: true }) : json({ error: "no_run" }, 409);
}
