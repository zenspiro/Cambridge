import { adminPost } from "@/lib/adminPost";
import { BRAIN, SESSION_LABELS } from "@/lib/config";
import { reportError } from "@/lib/errors";
import { allow, limitKey } from "@/lib/ratelimit";
import { dispatchBrain } from "@/lib/agent/github";
import { failBrainRun, startBatchRun } from "@/lib/brain/runs";
import { batchCostCheck } from "@/lib/brain/spend";
import { filterQuery, filterWords, planBatch, readFilter, readStates } from "@/lib/brain/readAll";
import { getLibrarySettings, libraryYears } from "@/lib/settings";
import { loadSyllabus } from "@/lib/library/catalog";
import { loadPapers } from "@/lib/library/papers";

// Read all (owner, 8 Nov 2026): one brain run reads every stored question paper and mark scheme not read yet, for Core
// or Extended, one month or every month, one year or every year. The list is worked out here again (never taken from
// the form), the whole batch's rough cost is checked against the cap first, and the run checks it again before each
// paper.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const base = /^[0-9]{4}$/.test(code) ? `/admin/library/${code}` : "/admin/library";
  return adminPost(request, base, async ({ db, env, form, actorId }) => {
    const lib = await getLibrarySettings(db);
    const filter = readFilter((k) => (form.get(k) as string | null) ?? null, libraryYears(lib));
    if (!filter || base === "/admin/library") return "bad";
    const back = (e: string) => `${base}?${filterQuery(filter)}&e=${e}#read-all`;
    const [list, { papers }, state] = await Promise.all([loadSyllabus(db, code, lib), loadPapers(db, code), readStates(db, code)]);
    if (!list) return "bad";
    const plan = planBatch(list, papers, filter, state);
    if (!plan.toRead.length) return back("batch_none");
    const cost = await batchCostCheck(db, env, plan.toRead.map((d) => d.bytes));
    if (cost.verdict !== "ok") return back(cost.verdict);
    if (!(await allow(db, await limitKey("brain-run", actorId), BRAIN.runsPerHour, 3_600_000))) return back("busy");
    const jobId = await startBatchRun(db, plan.toRead.map((d) => d.docId), `${code} ${filterWords(filter, SESSION_LABELS)}`, actorId);
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
