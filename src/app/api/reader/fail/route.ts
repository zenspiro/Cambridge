import { json, JOB_ID_RE } from "@/lib/agent/api";
import { readerRequest } from "@/lib/brain/readerRequest";
import { activeBrainRun, failBrainRun } from "@/lib/brain/runs";
import { startQueued } from "@/lib/brain/queue";

// A session gives up on loading a reading: its run closes, nothing saved, the next queued run may start.
export async function POST(request: Request) {
  const a = await readerRequest(request, 2_000);
  if (!a.ok) return a.response;
  const jobId = a.body.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params || params.task !== "paper" || !params.session) return json({ error: "no_run" }, 409);
  await failBrainRun(a.db, jobId, "session_stopped");
  await startQueued(a.db, a.env);
  return json({ ok: true });
}
