import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { finishRun } from "@/lib/agent/runs";
import { AGENT } from "@/lib/config";

// The agent reports how the run went. Signed only. The report is stored as JSON
// and only ever shown as text in the admin panel.
export async function POST(request: Request) {
  const a = await agentRequest(request, AGENT.maxReportBytes + 4096);
  if (!a.ok) return a.response;
  const body = parseJson(a.body);
  const jobId = body?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const report = JSON.stringify(body?.report ?? {});
  if (report.length > AGENT.maxReportBytes) return json({ error: "too_big" }, 413);
  const ok = body?.ok === true;
  const done = await finishRun(a.db, jobId, ok, report, ok ? null : "agent");
  return done ? json({ ok: true }) : json({ error: "no_run" }, 409);
}
