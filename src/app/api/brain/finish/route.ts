import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { BRAIN } from "@/lib/config";
import { activeBrainRun, saveTree } from "@/lib/brain/runs";
import { clearReadings } from "@/lib/brain/readings";

// The finished topic tree and its check report. Signed only. The draft is cleaned and re-checked before saving.
export async function POST(request: Request) {
  const a = await agentRequest(request, BRAIN.maxTreeBytes * 2);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  const r = await saveTree(a.db, jobId, b?.draft, b?.report);
  // A saved tree means the kept readings did their job: a later Redraft reads afresh.
  if ((r === "ok_ready" || r === "ok_not_ready") && params?.task === "topics") await clearReadings(a.env.FILES, params.syllabusId);
  if (r === "no_run") return json({ error: r }, 409);
  if (r === "too_big" || r === "empty") return json({ error: r }, 422);
  return json({ ok: true, result: r });
}
