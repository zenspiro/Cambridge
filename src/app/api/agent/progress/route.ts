import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { cleanEvent, cleanEventText, cleanRunUrl, recordProgress } from "@/lib/agent/runs";

// The agent's live updates for the run page. Signed only.
// 409 means the run is no longer active (cancelled or closed): the agent stops.
export async function POST(request: Request) {
  const a = await agentRequest(request, 8 * 1024);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  const progress = Number(b?.progress);
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId) || !Number.isFinite(progress)) return json({ error: "bad_request" }, 400);
  const ok = await recordProgress(a.db, jobId, {
    progress,
    step: cleanEventText(b?.step, 120),
    event: cleanEvent(b?.event),
    runUrl: cleanRunUrl(b?.runUrl, a.env.GITHUB_REPO),
  });
  return ok ? json({ ok: true }) : json({ error: "no_run" }, 409);
}
