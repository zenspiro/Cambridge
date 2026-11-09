import { staffFor } from "@/lib/auth/staff";
import { getEnv } from "@/lib/env";
import { redirectTo } from "@/lib/http";
import { listSubjects, loadSyllabus } from "@/lib/library/catalog";
import { subjectMapJson } from "@/lib/library/map";
import { loadPapers } from "@/lib/library/papers";

// "Download map": the subject's whole hierarchy as JSON, the same structure the AI engine reads
// from /api/agent/catalog. Admin only, metadata only (no file contents), never cached.
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await staffFor({ area: "library", level: "view", code });
  if (!session) return redirectTo(request, "/admin/login");
  const env = await getEnv();
  const [list, { papers, routes }, subjects] = await Promise.all([loadSyllabus(env.DB, code), loadPapers(env.DB, code), listSubjects(env.DB)]);
  const subject = subjects.find((s) => s.code === code);
  if (!list || !subject) return new Response("Not found", { status: 404 });
  const body = JSON.stringify(subjectMapJson(subject, list, papers, routes), null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${code}-library-map.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
