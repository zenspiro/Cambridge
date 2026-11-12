import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { BRAIN } from "@/lib/config";
import { allow, limitKey } from "@/lib/ratelimit";
import { launchAsk } from "@/lib/brain/queue";
import { benchFilesFor } from "@/lib/brain/benchmark";

// Read the benchmark papers (owner, 11 Nov 2026): a Read all of the subject's benchmark papers only (docs/benchmark.md),
// so they can be scored. The list comes from the code's set, never the form; the cost is checked against the cap first,
// and the run checks it again before each paper, like Read all. Another run going on: it waits in the queue.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const base = /^[0-9]{4}$/.test(code) ? `/admin/library/${code}` : "/admin/library";
  return staffPost(request, base, ADMIN_EDIT, async ({ db, env, form, actorId }) => {
    if (!benchFilesFor(code).length || base === "/admin/library") return "bad";
    const back = (e: string) => `${base}?e=${e}#read-all`;
    if (!(await allow(db, await limitKey("brain-run", actorId), BRAIN.runsPerHour, 3_600_000))) return back("busy");
    // `again` (owner, 12 Nov 2026): every stored benchmark paper read afresh into the AI's own copy, for the score; the
    // readings people review and fix are left as they are.
    const again = form.get("again") === "1";
    const r = await launchAsk(db, env, { kind: "benchmark", code, ...(again ? { again: true } : {}) }, actorId);
    return back(r === "ok_batch" ? (again ? "ok_bench_again" : "ok_bench") : r);
  });
}
