import { adminPost, formId } from "@/lib/adminPost";
import { BRAIN } from "@/lib/config";
import { reportError } from "@/lib/errors";
import { allow, limitKey } from "@/lib/ratelimit";
import { dispatchBrain } from "@/lib/agent/github";
import { failBrainRun, startTreeRun, syllabusPdf } from "@/lib/brain/runs";

// "Draft topic tree" for one syllabus version: starts a brain run on GitHub Actions (one at a time).
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const back = /^\d{4}$/.test(code) ? `/admin/library/${code}/topics` : "/admin/library";
  return adminPost(request, back, async ({ db, env, form, actorId }) => {
    const id = formId(form, "syllabus");
    const y = id ? await db.prepare(`SELECT id FROM syllabus WHERE id = ?1 AND code = ?2`).bind(id, code).first<{ id: string }>() : null;
    if (!y) return "bad";
    if (!(await syllabusPdf(db, y.id))) return "no_pdf";
    if (!(await allow(db, await limitKey("brain-run", actorId), BRAIN.runsPerHour, 3_600_000))) return "busy";
    const jobId = await startTreeRun(db, y.id, actorId);
    if (!jobId) return "running";
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
      return failure === "not_set_up" ? "not_set_up" : "github";
    }
    return "ok_started";
  });
}
