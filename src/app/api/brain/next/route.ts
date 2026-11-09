import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { activeBrainRun, failBrainRun, finishBatchRun, nextBatchPaper } from "@/lib/brain/runs";
import { aiModels } from "@/lib/brain/aiSetup";
import { brainLimits, paperJobPayload } from "@/lib/brain/paperJob";
import { paperCostCheck } from "@/lib/brain/spend";

// Read all (owner, 8 Nov 2026): the script has saved one paper of its batch and asks for the next. The monthly cap is
// checked again before each paper (the spend so far is real by now); over it, the run stops with the papers read so far
// saved. `{ done: true }` when nothing is left. Signed only, a running batch only.
export async function POST(request: Request) {
  const a = await agentRequest(request, 8 * 1024);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (params?.task !== "paper" || !params.batch) return json({ error: "no_run" }, 409);
  const rest = params.batch.docs.slice(params.batch.docs.indexOf(params.docId) + 1);
  if (!rest.length) {
    await finishBatchRun(a.db, jobId);
    return json({ done: true });
  }
  const sizes = await a.db.prepare(`SELECT MAX(size_bytes) AS n FROM source_document WHERE id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(rest)).first<{ n: number | null }>();
  const cost = await paperCostCheck(a.db, a.env, sizes?.n ?? 0);
  if (cost.verdict !== "ok") {
    await failBrainRun(a.db, jobId, cost.verdict === "over_cap" ? "batch_cap" : "batch_price");
    return json({ done: true, stopped: cost.verdict });
  }
  const docId = await nextBatchPaper(a.db, jobId);
  if (!docId) return json({ done: true });
  const next = await activeBrainRun(a.db, jobId);
  if (next?.task !== "paper") return json({ error: "no_run" }, 409);
  const payload = await paperJobPayload(a.db, a.env.FILES, docId, next.scope, next.batch, await aiModels(a.db, a.env), brainLimits());
  return payload ? json(payload) : json({ error: "no_paper" }, 404);
}
