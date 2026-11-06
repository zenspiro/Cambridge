import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { activeBrainRun, syllabusPdf } from "@/lib/brain/runs";

// The syllabus PDF of a running topic tree run, for the brain script only. Signed only; the bytes go to the
// script (and from there to the two AIs), nowhere else.
export async function POST(request: Request) {
  const a = await agentRequest(request, 8 * 1024);
  if (!a.ok) return a.response;
  const jobId = parseJson(a.body)?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params) return json({ error: "no_run" }, 409);
  const pdf = await syllabusPdf(a.db, params.syllabusId);
  const obj = pdf ? await a.env.SOURCE.get(pdf.r2Key) : null;
  if (!obj) return json({ error: "not_found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
