import { staffFor } from "@/lib/auth/staff";
import { getEnv } from "@/lib/env";
import { reasonWords } from "@/lib/brain/labels";
import { batchPapers, runState } from "@/lib/brain/runs";
import { describeFile, loadPapers, paperLookup } from "@/lib/library/papers";

// A brain run's live state for the progress panel (asked every few seconds while it runs). Admin only, JSON, no-store.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Any staff member: a run's state only (the review screen and the Read all card ask it).
  const session = await staffFor(null);
  if (!session) return Response.json({ error: "signed_out" }, { status: 401 });
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const env = await getEnv();
  const r = await runState(env.DB, id);
  if (!r) return Response.json({ error: "not_found" }, { status: 404 });
  // Read all: where the batch is, and each paper with whether it is read yet and its open flags, in words.
  let batch = null;
  if (r.params?.task === "paper" && r.params.batch) {
    const current = r.params.docId;
    const list = await batchPapers(env.DB, r.params.batch.docs, r.createdAt);
    const code = r.params.batch.label.slice(0, 4);
    const look = paperLookup(/^[0-9]{4}$/.test(code) ? (await loadPapers(env.DB, code)).papers : []);
    batch = {
      label: r.params.batch.label.slice(5),
      at: r.params.batch.docs.indexOf(current) + 1,
      of: r.params.batch.docs.length,
      papers: list.map((p) => ({ docId: p.docId, name: describeFile(p.fileName, p.syllabusId, look), read: p.read, flags: p.flags, now: p.docId === current })),
    };
  }
  return Response.json(
    { status: r.status, step: r.step, events: r.events, createdAt: r.createdAt, finishedAt: r.finishedAt, stopped: r.status === "failed" ? reasonWords(r.errorRef) : null, batch },
    { headers: { "Cache-Control": "no-store" } },
  );
}
