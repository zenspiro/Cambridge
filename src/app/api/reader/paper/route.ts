import { json, JOB_ID_RE } from "@/lib/agent/api";
import { BRAIN } from "@/lib/config";
import { readerRequest } from "@/lib/brain/readerRequest";
import { activeBrainRun } from "@/lib/brain/runs";
import { savePaperReading } from "@/lib/brain/paperRead";
import { startQueued } from "@/lib/brain/queue";

// A session's whole reading of the paper, final: cleaned and saved like the AI's, its flags and automatic fixes
// recorded, scored as "Read in a dev session"; never the AI's own copy. Closes the run.
export async function POST(request: Request) {
  const a = await readerRequest(request, BRAIN.maxPaperBytes * 4);
  if (!a.ok) return a.response;
  const jobId = a.body.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params || params.task !== "paper" || !params.session) return json({ error: "no_run" }, 409);
  const { models: _models, checkedBy: _checked, ...raw } = a.body;
  const r = await savePaperReading(a.db, a.env.FILES, jobId, params.docId, { ...raw, read: true }, true, Date.now(), true, { full: true, session: true });
  if (r === "no_run") return json({ error: r }, 409);
  if (r !== "ok") return json({ error: r }, r === "too_big" ? 413 : 422);
  await startQueued(a.db, a.env);
  return json({ ok: true });
}
