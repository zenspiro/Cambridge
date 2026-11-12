import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { BRAIN } from "@/lib/config";
import { activeBrainRun } from "@/lib/brain/runs";
import { savePaperReading } from "@/lib/brain/paperRead";
import { startQueued } from "@/lib/brain/queue";

// A paper's reading from the brain script (merged with what was stored, flags worked out): first after Claude's
// reading, then again with the drawings (`final`). Signed only, a running paper run only.
export async function POST(request: Request) {
  const a = await agentRequest(request, BRAIN.maxPaperBytes * 4);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId) || !b) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params || params.task !== "paper") return json({ error: "no_run" }, 409);
  const full = !params.check && !params.scope.items.length && !params.scope.figures.length;
  const r = await savePaperReading(a.db, a.env.FILES, jobId, params.docId, b, b.final === true, Date.now(), !params.batch, { full, shadow: !!params.shadow });
  if (r === "no_run") return json({ error: r }, 409);
  if (r !== "ok") return json({ error: r }, r === "too_big" ? 413 : 422);
  // A one-paper run closes with its final save: the next run in the queue starts (owner, 12 Nov 2026).
  if (b.final === true && !params.batch) await startQueued(a.db, a.env);
  return json({ ok: true });
}
