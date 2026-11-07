import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { BRAIN } from "@/lib/config";
import { activeBrainRun } from "@/lib/brain/runs";
import { saveArt } from "@/lib/brain/paperRead";

// One figure page's drawing from the brain script (figures cut from the PDF, owner 7 Nov 2026), kept so figures are
// cut from it and the admin can move a box by hand. Signed only, a running paper run only, checked value by value.
export async function POST(request: Request) {
  const a = await agentRequest(request, BRAIN.maxArtBytes + 10_000);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId) || !b) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (!params || params.task !== "paper") return json({ error: "no_run" }, 409);
  const r = await saveArt(a.env.FILES, params.docId, b.art);
  if (r !== "ok") return json({ error: r }, r === "too_big" ? 413 : 422);
  return json({ ok: true });
}
