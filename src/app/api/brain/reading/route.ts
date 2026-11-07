import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { BRAIN } from "@/lib/config";
import { activeBrainRun } from "@/lib/brain/runs";
import { saveReading } from "@/lib/brain/readings";

// Keeps one finished reading (Claude's first try or Gemini's) so a run that stops later does not pay for it again.
// Signed only, a running topic tree run only.
export async function POST(request: Request) {
  const a = await agentRequest(request, BRAIN.maxTreeBytes * 2 + 4096);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params || params.task !== "topics") return json({ error: "no_run" }, 409);
  const r = await saveReading(a.db, a.env.FILES, params.syllabusId, b?.provider, b?.model, b?.raw);
  if (r !== "ok") return json({ error: r }, r === "too_big" ? 413 : 400);
  return json({ ok: true });
}
