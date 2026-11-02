import { agentRequest, json, JOB_ID_RE } from "@/lib/agent/api";
import { activeRun } from "@/lib/agent/runs";
import { AGENT, LIBRARY } from "@/lib/config";
import { reportError } from "@/lib/errors";
import { allow, limitKey } from "@/lib/ratelimit";
import { storeDocument } from "@/lib/library/store";

// The agent hands over one downloaded PDF. Signed only. Stored through the same
// path as manual uploads (name, year, size, PDF and duplicate checks, audit).
export async function POST(request: Request) {
  const a = await agentRequest(request, LIBRARY.maxFileBytes);
  if (!a.ok) return a.response;
  const h = request.headers;
  const jobId = h.get("x-agent-job") ?? "";
  const fileName = h.get("x-agent-file") ?? "";
  const siteId = h.get("x-agent-site") ?? "";
  const sourceUrl = h.get("x-agent-url") ?? "";
  if (!JOB_ID_RE.test(jobId) || !/^[A-Za-z0-9_-]{3,64}$/.test(siteId) || sourceUrl.length > 500) return json({ error: "bad_request" }, 400);

  const params = await activeRun(a.db, jobId);
  if (!params || params.mode !== "download") return json({ error: "no_run" }, 409);
  const site = await a.db
    .prepare(`SELECT base_url, kind FROM source_site WHERE id = ?1 AND enabled = 1`)
    .bind(siteId)
    .first<{ base_url: string; kind: string }>();
  // The file must come from an enabled, approved source; Drive files carry their Drive file link.
  const fromDrive = site?.kind === "gdrive" && /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,100}\/view$/.test(sourceUrl);
  if (!site || !(site.kind === "gdrive" ? fromDrive : sourceUrl.startsWith(site.base_url))) return json({ error: "source" }, 403);
  if (!(await allow(a.db, await limitKey("agent-files", jobId), AGENT.maxFilesPerRun, 24 * 3_600_000))) {
    return json({ error: "limit" }, 429);
  }
  try {
    const out = await storeDocument(a.env.DB, a.env.SOURCE, {
      fileName, bytes: a.body, actorId: "agent", origin: "agent", jobId, sourceUrl, sourceSiteId: siteId,
    });
    return json(out);
  } catch (err) {
    const ref = reportError("agent.file", err);
    return json({ fileName: fileName.slice(0, 80), ok: false, reason: "storage", ref }, 500);
  }
}
