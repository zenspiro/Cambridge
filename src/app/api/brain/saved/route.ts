import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { activeBrainRun } from "@/lib/brain/runs";
import { loadReading } from "@/lib/brain/readings";

// A kept reading for this run's syllabus version, if one matches the model and the current PDF. Signed only, a
// running topic tree run only.
export async function POST(request: Request) {
  const a = await agentRequest(request, 4 * 1024);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params || params.task !== "topics") return json({ error: "no_run" }, 409);
  const provider = b?.provider === "claude" || b?.provider === "gemini" ? b.provider : null;
  if (!provider || typeof b?.model !== "string") return json({ error: "bad_request" }, 400);
  const r = await loadReading(a.db, a.env.FILES, params.syllabusId, provider, b.model);
  return json(r ? { found: true, raw: r.raw, at: r.at } : { found: false });
}
