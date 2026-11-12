import { ADMIN_EDIT, staffPost } from "@/lib/auth/staff";
import { BRAIN } from "@/lib/config";
import { allow, limitKey } from "@/lib/ratelimit";
import { launchAsk } from "@/lib/brain/queue";

// Run the checks again on every paper read in this subject (owner, 9 Nov 2026): one run, no AI, so nothing is spent
// and the cap does not apply. Each reading as it stands (fixes included) is checked with today's checks and saved with
// its new flags; figures with no box are cut. The list is worked out on the server, never taken from the form.
// Another run going on (owner, 12 Nov 2026): it waits in the queue.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const base = /^[0-9]{4}$/.test(code) ? `/admin/library/${code}` : "/admin/library";
  return staffPost(request, base, ADMIN_EDIT, async ({ db, env, actorId }) => {
    if (base === "/admin/library") return "bad";
    const back = (e: string) => `${base}/documents?e=${e}`;
    if (!(await allow(db, await limitKey("brain-run", actorId), BRAIN.runsPerHour, 3_600_000))) return back("busy");
    return back(await launchAsk(db, env, { kind: "check", code }, actorId));
  });
}
