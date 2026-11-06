import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { saveCheck } from "@/lib/brain/aiSetup";
import { activeBrainRun, finishCheckRun } from "@/lib/brain/runs";

// The AI setup check's result (models listed and tried). Signed only, a running check run only.
export async function POST(request: Request) {
  const a = await agentRequest(request, 64 * 1024);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params || params.task !== "check") return json({ error: "no_run" }, 409);
  await saveCheck(a.db, b?.result);
  await finishCheckRun(a.db, jobId);
  return json({ ok: true });
}
