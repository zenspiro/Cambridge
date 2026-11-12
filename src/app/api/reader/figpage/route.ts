import { json, JOB_ID_RE } from "@/lib/agent/api";
import { BRAIN } from "@/lib/config";
import { readerRequest } from "@/lib/brain/readerRequest";
import { activeBrainRun } from "@/lib/brain/runs";
import { saveArt } from "@/lib/brain/paperRead";

// One figure page's drawing for a session's reading (cut from the PDF with Poppler in the session, like the script).
export async function POST(request: Request) {
  const a = await readerRequest(request, BRAIN.maxArtBytes + 10_000);
  if (!a.ok) return a.response;
  const jobId = a.body.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params || params.task !== "paper" || !params.session) return json({ error: "no_run" }, 409);
  const r = await saveArt(a.env.FILES, params.docId, a.body.art);
  if (r !== "ok") return json({ error: r }, r === "too_big" ? 413 : 422);
  return json({ ok: true });
}
