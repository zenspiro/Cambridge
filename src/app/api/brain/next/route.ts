import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { activeBrainRun, batchAdvance, failBrainRun, nextBatchPaper } from "@/lib/brain/runs";
import { aiModels } from "@/lib/brain/aiSetup";
import { brainLimits, paperJobPayload } from "@/lib/brain/paperJob";
import { paperCostCheck } from "@/lib/brain/spend";
import { startQueued } from "@/lib/brain/queue";

// Read all (owner, 8 Nov 2026): the script has saved one paper of its batch and asks for the next. The monthly cap is
// checked again before each paper (the spend so far is real by now); over it, the run stops with the papers read so far
// saved. `{ done: true }` when nothing is left. Signed only, a running batch only.
// Gemini down (owner, 12 Nov 2026): `skipped: true` says Gemini could not read the current paper; the run moves on and
// tries it once more at the end (`batchAdvance`); Gemini down for SKIP_STREAK_STOP papers in a row stops the run.
// When the run ends, the next run in the queue starts (owner, 12 Nov 2026).
export async function POST(request: Request) {
  const a = await agentRequest(request, 8 * 1024);
  if (!a.ok) return a.response;
  const b = parseJson(a.body);
  const jobId = b?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await activeBrainRun(a.db, jobId);
  if (params?.task !== "paper" || !params.batch) return json({ error: "no_run" }, 409);
  const step = batchAdvance(params.batch, params.docId, b?.skipped === true);
  const ended = async (body: Record<string, unknown>, lastStop: string | null = null) => {
    await startQueued(a.db, a.env, { lastStop });
    return json({ done: true, ...body });
  };
  if (step.stop) {
    await failBrainRun(a.db, jobId, "gemini_down");
    return ended({ stopped: "gemini_down" }, "gemini_down");
  }
  if (!step.candidates.length) {
    await nextBatchPaper(a.db, jobId, undefined, step); // keeps the skipped and failed lists, then closes the run
    return ended({});
  }
  const sizes = await a.db.prepare(`SELECT MAX(size_bytes) AS n FROM source_document WHERE id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(step.candidates)).first<{ n: number | null }>();
  // A check batch asks no AI, so the cap does not apply.
  const cost = params.check ? null : await paperCostCheck(a.db, a.env, sizes?.n ?? 0);
  if (cost && cost.verdict !== "ok") {
    const why = cost.verdict === "over_cap" ? "batch_cap" : "batch_price";
    await failBrainRun(a.db, jobId, why);
    return ended({ stopped: cost.verdict }, why);
  }
  const docId = await nextBatchPaper(a.db, jobId, undefined, step);
  if (!docId) return ended({});
  const next = await activeBrainRun(a.db, jobId);
  if (next?.task !== "paper") return json({ error: "no_run" }, 409);
  const payload = await paperJobPayload(a.db, a.env.FILES, docId, next.scope, next.batch, await aiModels(a.db, a.env), brainLimits(), undefined, next.check, next.shadow);
  // The second try of the skipped papers waits a little first, so a busy spell has time to pass.
  return payload ? json({ ...payload, ...(step.retryPass ? { waitMs: 120_000 } : {}) }) : json({ error: "no_paper" }, 404);
}
