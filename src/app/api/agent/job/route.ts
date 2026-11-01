import { agentRequest, json, JOB_ID_RE, parseJson } from "@/lib/agent/api";
import { claimRun } from "@/lib/agent/runs";
import { AGENT, LIBRARY } from "@/lib/config";
import { STORED_NAMES } from "@/lib/library/queries";
import { getLibrarySettings } from "@/lib/settings";

// The agent asks what to do: the run's choices, the enabled sources with their start
// pages, and the names already stored (so it never fetches them again). Signed only.
export async function POST(request: Request) {
  const a = await agentRequest(request);
  if (!a.ok) return a.response;
  const jobId = parseJson(a.body)?.jobId;
  if (typeof jobId !== "string" || !JOB_ID_RE.test(jobId)) return json({ error: "bad_request" }, 400);
  const params = await claimRun(a.db, jobId);
  if (!params) return json({ error: "no_run" }, 409);

  const [{ results: rows }, { results: names }, lib] = await Promise.all([
    a.db
      .prepare(`SELECT s.id, s.name, s.base_url, p.url FROM source_site s JOIN source_page p ON p.site_id = s.id
                WHERE s.enabled = 1 AND p.syllabus_code = ?1 ORDER BY s.created_at, p.created_at`)
      .bind(params.code)
      .all<{ id: string; name: string; base_url: string; url: string }>(),
    a.db.prepare(STORED_NAMES).bind(params.code).all<{ file_name: string }>(),
    getLibrarySettings(a.db),
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
    have: names.map((n) => n.file_name),
    limits: { maxFiles: AGENT.maxFilesPerRun, maxFileBytes: LIBRARY.maxFileBytes, delayMs: AGENT.delayMs, userAgentToken: AGENT.userAgentToken },
  });
}
