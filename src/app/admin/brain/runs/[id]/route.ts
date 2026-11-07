import { adminSession } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { reasonWords } from "@/lib/brain/labels";
import { runState } from "@/lib/brain/runs";

// A brain run's live state for the progress panel (asked every few seconds while it runs). Admin only, JSON, no-store.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await adminSession();
  if (!session) return Response.json({ error: "signed_out" }, { status: 401 });
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const env = await getEnv();
  const r = await runState(env.DB, id);
  if (!r) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(
    { status: r.status, step: r.step, events: r.events, createdAt: r.createdAt, finishedAt: r.finishedAt, stopped: r.status === "failed" ? reasonWords(r.errorRef) : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
