import { json, JOB_ID_RE } from "@/lib/agent/api";
import { readerRequest } from "@/lib/brain/readerRequest";
import { startSessionRun } from "@/lib/brain/runs";
import { autoHold, handFixed, paperDoc } from "@/lib/brain/paperRead";

// A dev session starts loading its own reading of one paper (owner, 12 Nov 2026). Refused while another brain run
// goes on, and for a paper a person has fixed by hand unless `replace` is sent (the session says so first).
export async function POST(request: Request) {
  const a = await readerRequest(request, 4_000);
  if (!a.ok) return a.response;
  const docId = a.body.docId;
  if (typeof docId !== "string" || !JOB_ID_RE.test(docId)) return json({ error: "bad_request" }, 400);
  const doc = await paperDoc(a.db, docId);
  if (!doc || (doc.docType !== "qp" && doc.docType !== "ms")) return json({ error: "not_a_paper" }, 404);
  if (a.body.replace !== true && (await handFixed(a.db, docId))) return json({ error: "hand_fixed" }, 409);
  const jobId = await startSessionRun(a.db, docId);
  if (!jobId) return json({ error: "busy" }, 409);
  return json({ jobId, kind: doc.docType, hold: await autoHold(a.db, doc) });
}
