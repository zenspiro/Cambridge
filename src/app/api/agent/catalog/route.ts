import { agentRequest, json } from "@/lib/agent/api";
import { loadCatalog } from "@/lib/library/catalog";
import type { Cell, PaperRow } from "@/lib/library/checklist";

// The library hierarchy for the AI engine (GitHub Actions jobs): qualification > subject >
// syllabus > versions and sessions > files, each marked essential or extra, stored or missing.
// Signed only. Metadata only: file contents are never sent from here.
const out = (c: Cell) => ({
  fileName: c.fileName, docType: c.docType, paper: c.paper, variant: c.variant, essential: c.essential,
  documentId: c.doc?.id ?? null, sha256: c.doc?.sha256 ?? null, sizeBytes: c.doc?.size_bytes ?? null,
});
const rows = (r: PaperRow[]) => r.flatMap((x) => Object.values(x.cells).map((c) => out(c as Cell)));

export async function POST(request: Request) {
  const a = await agentRequest(request, 4096);
  if (!a.ok) return a.response;
  const { library, qualifications } = await loadCatalog(a.db);
  return json({
    library,
    qualifications: qualifications.map((q) => ({
      id: q.id, name: q.name,
      subjects: q.subjects.map((s) => ({
        id: s.id, name: s.name,
        syllabuses: s.syllabuses.map((y) => ({
          code: y.code, title: y.title, status: y.checklist.status,
          versions: y.checklist.versions.map((g) => ({
            id: g.version.id, from: g.version.valid_from_year, to: g.version.valid_to_year, status: g.status,
            files: [...g.docs.map(out), ...rows(g.specimens)],
          })),
          sessions: y.checklist.sessions.map((g) => ({
            year: g.year, session: g.session, status: g.status, files: [...g.docs.map(out), ...rows(g.rows)],
          })),
          otherFiles: y.checklist.others.map(out),
        })),
      })),
    })),
  });
}
