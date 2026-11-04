import { agentRequest, json } from "@/lib/agent/api";
import { loadCatalog } from "@/lib/library/catalog";
import { subjectMapJson } from "@/lib/library/map";
import { loadPapers } from "@/lib/library/papers";

// The library hierarchy for the AI engine (GitHub Actions jobs): qualification > subject >
// syllabus > versions (papers, routes, documents, specimens, sessions) > files, each described in
// words and marked essential or extra, stored or missing. The same map as the library page and
// its "Download map" button (src/lib/library/map.ts). Signed only. Metadata only.
export async function POST(request: Request) {
  const a = await agentRequest(request, 4096);
  if (!a.ok) return a.response;
  const { library, qualifications } = await loadCatalog(a.db);
  const out = [];
  for (const q of qualifications) {
    const subjects = [];
    for (const s of q.subjects) {
      const syllabuses = [];
      for (const y of s.syllabuses) {
        const { papers, routes } = await loadPapers(a.db, y.code);
        syllabuses.push(subjectMapJson({ code: y.code, label: `${q.shortName} ${s.name} (${y.code})`, qualification: q.shortName }, y.checklist, papers, routes));
      }
      subjects.push({ id: s.id, name: s.name, syllabuses });
    }
    out.push({ id: q.id, name: q.name, subjects });
  }
  return json({ library, qualifications: out });
}
