import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { BRAIN } from "@/lib/config";
import { reportError } from "@/lib/errors";
import { allow, limitKey } from "@/lib/ratelimit";
import { dispatchBrain } from "@/lib/agent/github";
import { failBrainRun, startBatchRun } from "@/lib/brain/runs";
import { batchCostCheck } from "@/lib/brain/spend";
import { planBenchmark, readStates } from "@/lib/brain/readAll";
import { benchFilesFor } from "@/lib/brain/benchmark";

// Read the benchmark papers (owner, 11 Nov 2026): a Read all of the subject's benchmark papers only (docs/benchmark.md),
// so they can be scored. The list comes from the code's set, never the form; the cost is checked against the cap first,
// and the run checks it again before each paper, like Read all.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const base = /^[0-9]{4}$/.test(code) ? `/admin/library/${code}` : "/admin/library";
  return staffPost(request, base, ADMIN_EDIT, async ({ db, env, actorId }) => {
    const files = benchFilesFor(code);
    if (!files.length || base === "/admin/library") return "bad";
    const back = (e: string) => `${base}?e=${e}#read-all`;
    const plan = await planBenchmark(db, files, await readStates(db, code));
    if (!plan.toRead.length) return back("batch_none");
    const cost = await batchCostCheck(db, env, plan.toRead.map((d) => d.bytes));
    if (cost.verdict !== "ok") return back(cost.verdict);
    if (!(await allow(db, await limitKey("brain-run", actorId), BRAIN.runsPerHour, 3_600_000))) return back("busy");
    const jobId = await startBatchRun(db, plan.toRead.map((d) => d.docId), `${code} benchmark papers`, actorId);
    if (!jobId) return back("running");
    let failure: string | null = null;
    try {
      const d = await dispatchBrain(env, jobId);
      if (!d.ok) failure = d.reason === "not_set_up" ? "not_set_up" : `github_${d.status ?? "error"}`;
    } catch (err) {
      failure = "github_unreachable";
      reportError("brain.dispatch", err);
    }
    if (failure) {
      if (failure !== "not_set_up") reportError("brain.dispatch", new Error(failure));
      await failBrainRun(db, jobId, failure);
      return back(failure === "not_set_up" ? "not_set_up" : "github");
    }
    return back("ok_batch");
  });
}
