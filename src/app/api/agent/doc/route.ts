import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { activeRun } from "@/lib/agent/runs";

// A library check reads one stored file to check its first page. Signed only, a running
// check run only, and only files of that run's subject. The bytes go to the agent, nowhere else.
export async function POST(request: Request) {
  const a = await agentRequest(request);
  if (!a.ok) return a.response;
  const body = parseJson(a.body);
  const jobId = body?.jobId;
  const id = body?.id;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId) || typeof id !== "string" || !/^[A-Za-z0-9_-]{3,64}$/.test(id)) return json({ error: "bad_request" }, 400);
  const params = await activeRun(a.db, jobId);
  if (!params || params.mode !== "check") return json({ error: "no_run" }, 409);
  const row = await a.db
    .prepare(`SELECT d.r2_key FROM source_document d JOIN syllabus s ON s.id = d.syllabus_id WHERE d.id = ?1 AND d.status = 'stored' AND s.code = ?2`)
    .bind(id, params.code)
    .first<{ r2_key: string }>();
  if (!row) return json({ error: "not_found" }, 404);
  const obj = await a.env.SOURCE.get(row.r2_key);
  if (!obj) return json({ error: "not_found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
}
