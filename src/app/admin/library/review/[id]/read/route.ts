import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { BRAIN } from "@/lib/config";
import { reportError } from "@/lib/errors";
import { allow, limitKey } from "@/lib/ratelimit";
import { dispatchBrain } from "@/lib/agent/github";
import { failBrainRun, startPaperRun } from "@/lib/brain/runs";
import { PAPER_KINDS, paperDoc } from "@/lib/brain/paperRead";
import { readerChoices } from "@/lib/brain/spend";
import type { PaperKind } from "@/lib/brain/paper";

const ITEM_RE = /^[0-9]{1,3}(\([a-z]{1,4}\)){0,3}$/;
const FIG_RE = /^[A-Za-z0-9_.-]{1,20}$/;

// "Read this paper" (or "Read it again" for one question, or "Cut it again" for one figure): a brain run on GitHub for
// one question paper or mark scheme, inside the monthly spending cap (cutting figures uses no AI, so it is not capped).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = /^[A-Za-z0-9_-]{10,64}$/.test(id) ? `/admin/library/review/${id}` : "/admin/library";
  return staffPost(request, back, ADMIN_EDIT, async ({ db, env, form, actorId }) => {
    const doc = await paperDoc(db, id);
    if (!doc || !PAPER_KINDS.includes(doc.docType as PaperKind)) return "bad";
    const items = form.getAll("item").map(String).filter((x) => ITEM_RE.test(x)).slice(0, 50);
    const figures = form.getAll("figure").map(String).filter((x) => FIG_RE.test(x)).slice(0, 50);
    const size = await db.prepare(`SELECT size_bytes FROM source_document WHERE id = ?1`).bind(id).first<{ size_bytes: number }>();
    // "Read with" (owner, 9 Nov 2026): the AI for this reading only, one of the choices the page offered; empty is the
    // saved Reading AI. Its own rough cost is checked against the cap.
    let reader: string | undefined;
    if (items.length || !figures.length) {
      const want = String(form.get("reader") ?? "");
      const choice = (await readerChoices(db, env, size?.size_bytes ?? 0)).find((c) => c.value === want);
      if (!choice) return "bad";
      if (choice.check.verdict !== "ok") return choice.check.verdict;
      reader = choice.value || undefined;
    }
    if (!(await allow(db, await limitKey("brain-run", actorId), BRAIN.runsPerHour, 3_600_000))) return "busy";
    const jobId = await startPaperRun(db, id, { items, figures }, actorId, Date.now(), reader);
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
