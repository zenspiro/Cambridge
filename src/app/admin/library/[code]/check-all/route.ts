import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { BRAIN } from "@/lib/config";
import { reportError } from "@/lib/errors";
import { allow, limitKey } from "@/lib/ratelimit";
import { dispatchBrain } from "@/lib/agent/github";
import { failBrainRun, startBatchRun } from "@/lib/brain/runs";

// Run the checks again on every paper read in this subject (owner, 9 Nov 2026): one run, no AI, so nothing is spent
// and the cap does not apply. Each reading as it stands (fixes included) is checked with today's checks and saved with
// its new flags; figures with no box are cut. The list is worked out here, never taken from the form.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const base = /^[0-9]{4}$/.test(code) ? `/admin/library/${code}` : "/admin/library";
  return staffPost(request, base, ADMIN_EDIT, async ({ db, env, actorId }) => {
    if (base === "/admin/library") return "bad";
    const back = (e: string) => `${base}/documents?e=${e}`;
    const { results } = await db
      .prepare(`SELECT p.doc_id FROM paper_read p JOIN source_document d ON d.id = p.doc_id
                WHERE p.read_at IS NOT NULL AND d.status = 'stored' AND d.syllabus_id LIKE ?1 ORDER BY d.file_name LIMIT ?2`)
      .bind(`${code}-%`, BRAIN.maxBatchPapers)
      .all<{ doc_id: string }>();
    if (!results.length) return back("check_none");
    if (!(await allow(db, await limitKey("brain-run", actorId), BRAIN.runsPerHour, 3_600_000))) return back("busy");
    const jobId = await startBatchRun(db, results.map((r) => r.doc_id), `${code} checks again`, actorId, Date.now(), true);
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
    return back("ok_check");
  });
}
