import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { BRAIN } from "@/lib/config";
import { saveTree } from "@/lib/brain/runs";

// The finished topic tree and its check report. Signed only. The draft is cleaned and re-checked before saving.
export async function POST(request: Request) {
  const a = await agentRequest(request, BRAIN.maxTreeBytes * 2);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const r = await saveTree(a.db, jobId, b?.draft, b?.report);
  if (r === "no_run") return json({ error: r }, 409);
  if (r === "too_big" || r === "empty") return json({ error: r }, 422);
  return json({ ok: true, result: r });
}
