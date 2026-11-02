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
  // Remember what each Drive folder held, for the Sources page.
  const folders = (body?.report as { driveFolders?: unknown } | undefined)?.driveFolders;
  if (done && Array.isArray(folders)) {
    for (const f of folders.slice(0, 100)) {
      const id = (f as { folderId?: unknown })?.folderId;
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{10,100}$/.test(id)) continue;
      const summary = JSON.stringify(f);
      if (summary.length > 4000) continue;
      await a.db.prepare(`UPDATE source_drive_folder SET last_seen = ?2, last_seen_at = ?3 WHERE folder_id = ?1`).bind(id, summary, Date.now()).run();
    }
  }
  return done ? json({ ok: true }) : json({ error: "no_run" }, 409);
}
