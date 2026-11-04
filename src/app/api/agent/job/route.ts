import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { claimRun } from "@/lib/agent/runs";
import { AGENT, LIBRARY } from "@/lib/config";
import { STORED_NAMES } from "@/lib/library/queries";
import { getLibrarySettings } from "@/lib/settings";
import { decisionsForAgent } from "@/lib/agent/review";

// The agent asks what to do: the run's choices, the enabled sources with their start
// pages, the names already stored (so it never fetches them again) and the owner's decisions
// on files that needed an eye (accepted under a name, or rejected). Signed only.
export async function POST(request: Request) {
  const a = await agentRequest(request);
  if (!a.ok) return a.response;
  const jobId = parseJson(a.body)?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await claimRun(a.db, jobId);
  if (!params) return json({ error: "no_run" }, 409);

  const [{ results: rows }, { results: names }, lib, { results: folders }, { results: subjects }, decisions] = await Promise.all([
    a.db
      .prepare(`SELECT s.id, s.name, s.base_url, p.url FROM source_site s JOIN source_page p ON p.site_id = s.id
                WHERE s.enabled = 1 AND s.kind = 'web' AND p.syllabus_code = ?1 ORDER BY s.created_at, p.created_at`)
      .bind(params.code)
      .all<{ id: string; name: string; base_url: string; url: string }>(),
    a.db.prepare(STORED_NAMES).bind(params.code).all<{ file_name: string }>(),
    getLibrarySettings(a.db),
    a.db
      .prepare(`SELECT f.folder_id, f.label, s.id AS site_id FROM source_drive_folder f JOIN source_site s ON s.id = f.site_id
                WHERE s.enabled = 1 AND s.kind = 'gdrive' ORDER BY f.created_at`)
      .bind()
      .all<{ folder_id: string; label: string; site_id: string }>(),
    a.db
      .prepare(`SELECT DISTINCT y.code, s.name, q.short_name AS qualification FROM syllabus y JOIN subject s ON s.id = y.subject_id
                JOIN qualification q ON q.id = s.qualification_id ORDER BY y.code`)
      .bind()
      .all<{ code: string; name: string; qualification: string }>(),
    decisionsForAgent(a.db),
  ]);
  const sources = new Map<string, { siteId: string; name: string; baseUrl: string; pages: string[] }>();
  for (const r of rows) {
    const s = sources.get(r.id) ?? { siteId: r.id, name: r.name, baseUrl: r.base_url, pages: [] };
    if (r.url.startsWith(r.base_url)) s.pages.push(r.url);
    sources.set(r.id, s);
  }
  return json({
    params,
    library: lib,
    sources: [...sources.values()],
    driveFolders: folders.map((f) => ({ siteId: f.site_id, folderId: f.folder_id, label: f.label })),
    subjects,
    have: names.map((n) => n.file_name),
    decisions,
    limits: {
      maxFiles: AGENT.maxFilesPerRun, maxFileBytes: LIBRARY.maxFileBytes, delayMs: AGENT.delayMs, userAgentToken: AGENT.userAgentToken,
      driveDelayMs: AGENT.driveDelayMs, driveMaxFolders: AGENT.driveMaxFolders, driveMaxDepth: AGENT.driveMaxDepth,
    },
  });
}
