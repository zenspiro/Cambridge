import { staffFor } from "@/lib/auth/staff";
import { getEnv } from "@/lib/env";
import { activeRuns } from "@/lib/adminStatus";
import { readQueue } from "@/lib/brain/queue";

// The brain run going on now, in words, and how many asks wait in the queue (owner, 12 Nov 2026: "Another AI run is
// going on" names the run and how far it has got). Asked by ActionForm when a button answers `running` or `ok_queued`.
// Any staff member, JSON, no-store.
export async function GET() {
  const session = await staffFor(null);
  if (!session) return Response.json({ error: "signed_out" }, { status: 401 });
  const env = await getEnv();
  const [runs, queue] = await Promise.all([activeRuns(env.DB), readQueue(env.DB)]);
  const brain = runs.find((r) => !r.href.startsWith("/admin/agent"));
  return Response.json(
    { run: brain ? { label: brain.label, step: brain.step, href: brain.href } : null, waiting: queue.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
