import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { activeBrainRun, syllabusPdf } from "@/lib/brain/runs";

// The PDF of a running brain run (a topic tree's syllabus, or the paper being read), for the brain script only. Signed only; the bytes go to the
// script (and from there to the two AIs), nowhere else.
export async function POST(request: Request) {
  const a = await agentRequest(request, 8 * 1024);
  if (!a.ok) return a.response;
  const jobId = parseJson(a.body)?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params || params.task === "check") return json({ error: "no_run" }, 409);
  const r2Key = params.task === "topics"
    ? (await syllabusPdf(a.db, params.syllabusId))?.r2Key
    : (await a.db.prepare(`SELECT r2_key FROM source_document WHERE id = ?1 AND status = 'stored'`).bind(params.docId).first<{ r2_key: string }>())?.r2_key;
  const obj = r2Key ? await a.env.SOURCE.get(r2Key) : null;
  if (!obj) return json({ error: "not_found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
