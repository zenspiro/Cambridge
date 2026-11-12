// What the admin frame shows on every page (owner, 8 Nov 2026: a working admin, not just a pretty one): the runs going
// on now, each with a link to where it can be watched. Takes the database as a parameter. No Next imports.
import type { Db } from "./db.ts";
import { AGENT_ERRORS } from "./agent/labels.ts";
import { BRAIN_REASONS } from "./brain/labels.ts";

export type ActiveRun = { id: string; label: string; href: string; step: string | null; queued: boolean };

const AGENT_MODES: Record<string, string> = { dry: "Agent dry run", download: "Agent download", check: "Library check" };

/** Runs queued or running (agent and brain), newest first, with plain words and a link. Pure on its row. */
export function describeRun(r: { id: string; type: string; status: string; params: string; step: string | null }): ActiveRun | null {
  let p: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(r.params);
    if (v && typeof v === "object") p = v as Record<string, unknown>;
  } catch {
    p = {};
  }
  const queued = r.status === "queued";
  const code = typeof p.code === "string" ? ` ${p.code}` : "";
  if (r.type === "agent") {
    return { id: r.id, label: `${AGENT_MODES[String(p.mode)] ?? "Agent run"}${code}`, href: `/admin/agent/runs/${encodeURIComponent(r.id)}`, step: r.step, queued };
  }
  if (r.type === "brain") {
    const b = p.batch && typeof p.batch === "object" ? (p.batch as { docs?: unknown; label?: unknown }) : null;
    if (p.task === "paper" && typeof p.docId === "string" && b && Array.isArray(b.docs)) {
      const at = b.docs.indexOf(p.docId) + 1;
      const code = typeof b.label === "string" && /^[0-9]{4} /.test(b.label) ? b.label.slice(0, 4) : "";
      // Watched where it was started: the subject's Read all card (owner, 9 Nov 2026).
      // Named by what was asked ("0580 benchmark papers"), so a message can say which run is going on (owner, 12 Nov 2026).
      const what = typeof b.label === "string" && b.label ? b.label : p.check ? "checks again" : "Read all";
      return { id: r.id, label: `${p.check ? "Checking" : "Reading"} ${what}: paper ${at} of ${b.docs.length}`, href: code ? `/admin/library/${code}#read-all` : `/admin/library/review/${encodeURIComponent(p.docId)}`, step: r.step, queued };
    }
    if (p.task === "paper" && typeof p.docId === "string") return { id: r.id, label: p.session ? "Loading a reading from a dev session" : "Reading a paper", href: `/admin/library/review/${encodeURIComponent(p.docId)}`, step: r.step, queued };
    if (p.task === "check") return { id: r.id, label: "AI setup check", href: "/admin/ai", step: r.step, queued };
    return { id: r.id, label: "Drafting a topic tree", href: "/admin/topics", step: r.step, queued };
  }
  return null;
}

export async function activeRuns(db: Db): Promise<ActiveRun[]> {
  const { results } = await db
    .prepare(`SELECT id, type, status, params, step FROM job WHERE status IN ('queued', 'running') AND type IN ('agent', 'brain') ORDER BY created_at DESC LIMIT 5`)
    .bind()
    .all<{ id: string; type: string; status: string; params: string; step: string | null }>();
  return results.flatMap((r) => {
    const d = describeRun(r);
    return d ? [d] : [];
  });
}

/** The audit log in plain words (screens show words, never internal codes). */
const ACTIVITY: Record<string, string> = {
  "admin.login": "Signed in", "admin.logout": "Signed out", "admin.login_failed": "Wrong admin password", "admin.login_locked": "Admin sign-in locked (too many tries)",
  "source.upload": "Uploaded a source file", "source.agent": "The agent stored a source file", "source.link": "Added a source file from a link",
  "source.download": "Downloaded a source file", "source.view": "Viewed a source file", "source.rename": "Renamed a stored file", "source.remove": "Removed a stored file",
  "source.folder": "Uploaded a file from a folder",
  "source_site.add": "Added a source website", "source_site.enable": "Switched on a source website", "source_site.disable": "Switched off a source website",
  "source_site.remove": "Removed a source website", "source_page.add": "Added a start page", "source_page.remove": "Removed a start page",
  "drive_folder.add": "Added Google Drive folders", "drive_folder.remove": "Removed a Google Drive folder",
  "setting.library": "Changed library settings", "setting.consent": "Changed parent approval ages", "syllabus.variants": "Changed essential variants",
  "library.alias": "Learned another code for a syllabus",
  "agent.start_dry": "Started an agent dry run", "agent.start_download": "Started an agent download", "agent.start_check": "Started a library check",
  "agent.finish": "Agent run finished", "agent.fail": "Agent run failed", "agent.cancel": "Cancelled an agent run",
  "review.accept": "Accepted a file the agent could not place", "review.reject": "Rejected a file the agent could not place", "review.undo": "Undid a file decision",
  "brain.topics_start": "Started a topic tree draft", "brain.topics_saved": "A topic tree was saved", "brain.paper_start": "Started reading a paper",
  "brain.paper_saved": "A paper reading was saved", "brain.batch_start": "Started Read all", "brain.batch_done": "Read all finished", "brain.fail": "A subject brain run stopped", "brain.check_start": "Started an AI setup check",
  "brain.ai_check": "AI setup check finished", "brain.claude_model": "Changed the main AI's model", "brain.gemini_model": "Changed the checking AI's model",
  "brain.drawing_model": "Changed the drawing AI's model", "brain.reading_model": "Changed the reading AI's model", "brain.price": "Changed an AI price",
  "brain.cap": "Changed the monthly AI cap",
  "brain.queue_add": "Added a run to the queue", "brain.queue_remove": "Removed a run from the queue", "brain.queue_start": "A queued run started",
  "brain.queue_drop": "A queued run had nothing left to read",
  "home.clear": "Cleared an item from Needs you", "home.clear_all": "Cleared Needs you", "home.undo": "Brought back an item to Needs you",
  "icons.choose": "Changed an icon", "icons.reset": "Put an icon back to its default",
  "paper.pdf": "Used the PDF's version on a paper", "paper.edit": "Edited a paper part", "paper.fine": "Marked a paper flag as fine",
  "paper.looks_right": "Confirmed a figure", "paper.override": "Marked a paper ready anyway", "paper.unoverride": "Took back a paper's ready mark",
  "paper.undo": "Undid a paper fix", "paper.box": "Drew a figure box by hand",
  "brand.text": "Changed the brand words", "brand.image": "Changed a brand picture", "brand.remove": "Removed a brand picture",
  "account.created": "A new account was made", "account.created_by_parent": "A parent made an account for their child", "account.signin": "Someone signed in",
  "account.signout": "Someone signed out", "account.welcome": "A new account finished its welcome", "account.deleted": "An account was deleted",
  "account.export": "Someone downloaded their data", "account.export_by_parent": "A parent downloaded their child's data",
  "consent.sent": "A parent approval request was sent", "consent.approved": "A parent approved their child", "consent.declined": "A parent declined (account deleted)",
  "family.add": "A child joined a family", "family.remove": "A parent removed a child from the family", "family.leave": "A child left a family", "family.code": "A family code was made",
};

const AREAS: Record<string, string> = {
  account: "Account", admin: "Admin", agent: "Agent", brain: "Subject brain", brand: "Brand", consent: "Parent approval", family: "Families",
  paper: "Paper review", review: "Agent review", setting: "Settings", source: "Source library", source_site: "Sources", source_page: "Sources",
  drive_folder: "Sources", syllabus: "Library", library: "Library", home: "Home", icons: "Icons",
};

/** One audit action in words; an action without words names its area ("Paper review: other change"). Pure. */
export function activityWords(action: string): string {
  if (Object.hasOwn(ACTIVITY, action)) return ACTIVITY[action]!;
  const area = action.split(".")[0] ?? "";
  return `${Object.hasOwn(AREAS, area) ? AREAS[area] : "Other"}: other change`;
}

export type FailedRun = { id: string; label: string; href: string; at: number; why: string };

/**
 * What a run was about, so a later run that succeeded at the same thing settles an earlier stop: an agent run's
 * subject and mode, a paper (a batch counts for each of its papers), a topic tree, an AI setup check. Pure.
 */
export function runKeys(params: string, type: string): string[] {
  let p: Record<string, unknown> = {};
  try {
    const v: unknown = JSON.parse(params);
    if (v && typeof v === "object") p = v as Record<string, unknown>;
  } catch {
    return [];
  }
  if (type === "agent") return typeof p.code === "string" ? [`agent:${p.code}:${String(p.mode ?? "")}`] : [];
  if (p.task === "paper") {
    const b = p.batch && typeof p.batch === "object" ? (p.batch as { docs?: unknown }) : null;
    const docs = b && Array.isArray(b.docs) ? b.docs.filter((x): x is string => typeof x === "string") : [];
    return docs.length ? [`batch:${docs.join(",")}`, ...docs.map((d) => `paper:${d}`)] : typeof p.docId === "string" ? [`paper:${p.docId}`] : [];
  }
  if (p.task === "topics" && typeof p.syllabusId === "string") return [`topics:${p.syllabusId}`];
  if (p.task === "check") return [`check:${String(p.which ?? "")}`];
  return [];
}

type JobRow = { id: string; type: string; status: string; params: string; step: string | null; error_ref: string | null; at: number; created_at: number };

/**
 * Agent and subject brain runs that stopped in the last `days` days and still need a look, newest first: not cleared
 * by hand, and not settled by a later run of the same thing that succeeded (owner, 9 Nov 2026).
 */
export async function failedRuns(db: Db, now = Date.now(), days = 7, limit = 5): Promise<{ list: FailedRun[]; total: number }> {
  const since = now - days * 86_400_000;
  const { results } = await db
    .prepare(`SELECT id, type, status, params, step, error_ref, COALESCE(finished_at, created_at) AS at, created_at FROM job
              WHERE type IN ('agent', 'brain') AND created_at >= ?1 AND (status = 'succeeded' OR (status = 'failed' AND cleared_at IS NULL))
              ORDER BY created_at DESC LIMIT 300`)
    .bind(since)
    .all<JobRow>();
  // A batch, or a paper read since by any run, settles a stop for that paper too.
  const read = await db.prepare(`SELECT doc_id, read_at FROM paper_read WHERE read_at >= ?1`).bind(since).all<{ doc_id: string; read_at: number }>();
  const readAt = new Map(read.results.map((r) => [`paper:${r.doc_id}`, r.read_at]));
  const settled = (r: JobRow) => {
    const keys = runKeys(r.params, r.type);
    if (!keys.length) return false;
    const later = results.filter((x) => x.status === "succeeded" && x.created_at > r.created_at);
    const paperKeys = keys.filter((k) => k.startsWith("paper:"));
    // A single paper: settled once it is read after the stop. A batch: once every one of its papers is.
    if (paperKeys.length && paperKeys.every((k) => (readAt.get(k) ?? 0) > r.created_at)) return true;
    return later.some((x) => {
      const done = runKeys(x.params, x.type);
      return keys[0] !== undefined && done.includes(keys[0]);
    });
  };
  const list = results.filter((r) => r.status === "failed" && !settled(r)).flatMap((r) => {
    const d = describeRun({ ...r, status: "running" });
    const words = r.type === "agent" ? AGENT_ERRORS : BRAIN_REASONS;
    const why = r.error_ref && Object.hasOwn(words, r.error_ref) ? words[r.error_ref]! : "It stopped with an error; its page has the details.";
    return d ? [{ id: r.id, label: d.label, href: d.href, at: r.at, why }] : [];
  });
  return { list: list.slice(0, limit), total: list.length };
}

/** Clears one item from Home, or every one shown (`all`); `undo` brings one back. Returns how many changed. */
export async function clearNeed(db: Db, kind: "run" | "paper", id: string | "all", undo: boolean, now = Date.now()): Promise<number> {
  if (kind === "run") {
    if (id === "all") {
      const { list } = await failedRuns(db, now, 7, 300);
      if (!list.length) return 0;
      await db.prepare(`UPDATE job SET cleared_at = ?2 WHERE id IN (SELECT value FROM json_each(?1)) AND status = 'failed'`).bind(JSON.stringify(list.map((r) => r.id)), now).run();
      return list.length;
    }
    const r = await db.prepare(`UPDATE job SET cleared_at = ?2 WHERE id = ?1 AND status = 'failed' AND type IN ('agent', 'brain') RETURNING id`).bind(id, undo ? null : now).first();
    return r ? 1 : 0;
  }
  if (id === "all") {
    const { list } = await papersToReview(db, 1000);
    if (!list.length) return 0;
    await db.prepare(`UPDATE paper_read SET cleared_at = ?2 WHERE doc_id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(list.map((r) => r.docId)), now).run();
    return list.length;
  }
  const r = await db.prepare(`UPDATE paper_read SET cleared_at = ?2 WHERE doc_id = ?1 AND read_at IS NOT NULL RETURNING doc_id`).bind(id, undo ? null : now).first();
  return r ? 1 : 0;
}

export type ClearedItem = { kind: "run" | "paper"; id: string; at: number; fileName?: string; syllabusId?: string; code?: string; label?: string };

/** Items cleared by hand in the last day, newest first, so a mis-click can be undone. */
export async function recentlyCleared(db: Db, now = Date.now()): Promise<ClearedItem[]> {
  const since = now - 86_400_000;
  const [runs, papers] = await Promise.all([
    db.prepare(`SELECT id, type, status, params, step, cleared_at FROM job WHERE cleared_at >= ?1 ORDER BY cleared_at DESC LIMIT 20`).bind(since)
      .all<{ id: string; type: string; status: string; params: string; step: string | null; cleared_at: number }>(),
    db.prepare(`SELECT p.doc_id, p.cleared_at, d.file_name, d.syllabus_id, y.code FROM paper_read p JOIN source_document d ON d.id = p.doc_id JOIN syllabus y ON y.id = d.syllabus_id
                WHERE p.cleared_at >= ?1 AND p.cleared_at >= COALESCE(p.read_at, 0) ORDER BY p.cleared_at DESC LIMIT 20`).bind(since)
      .all<{ doc_id: string; cleared_at: number; file_name: string; syllabus_id: string; code: string }>(),
  ]);
  return [
    ...runs.results.map((r): ClearedItem => ({ kind: "run", id: r.id, at: r.cleared_at, label: describeRun({ ...r, status: "running" })?.label ?? "A run" })),
    ...papers.results.map((r): ClearedItem => ({ kind: "paper", id: r.doc_id, at: r.cleared_at, fileName: r.file_name, syllabusId: r.syllabus_id, code: r.code })),
  ].sort((a, b) => b.at - a.at);
}

export type PaperToReview = { docId: string; fileName: string; code: string; syllabusId: string; open: number; readAt: number; score: { items: number; flags: string; first_items: number | null; first_clean: number | null; first_red: number | null } };

/**
 * Read papers not yet ready: flags left after the ones settled on the paper (rules for the subject are left to the
 * review screen), not marked ready anyway. Most open flags first.
 */
export async function papersToReview(db: Db, limit = 8): Promise<{ list: PaperToReview[]; total: number; read: number }> {
  const { results } = await db
    .prepare(`SELECT p.doc_id, p.items, p.flags, p.dismissed, p.read_at, p.first_items, p.first_clean, p.first_red, d.file_name, d.syllabus_id, y.code
              FROM paper_read p JOIN source_document d ON d.id = p.doc_id JOIN syllabus y ON y.id = d.syllabus_id
              WHERE p.read_at IS NOT NULL AND p.override_at IS NULL AND (p.cleared_at IS NULL OR p.cleared_at < p.read_at)`)
    .bind()
    .all<{ doc_id: string; items: number; flags: string; dismissed: string; read_at: number; first_items: number | null; first_clean: number | null; first_red: number | null; file_name: string; syllabus_id: string; code: string }>();
  const all = await db.prepare(`SELECT COUNT(*) AS n FROM paper_read WHERE read_at IS NOT NULL`).bind().first<{ n: number }>();
  const open = (r: { flags: string; dismissed: string }) => {
    try {
      const flags = JSON.parse(r.flags) as { fingerprint?: string }[];
      const gone = new Set(JSON.parse(r.dismissed) as string[]);
      return Array.isArray(flags) ? flags.filter((f) => !gone.has(String(f?.fingerprint ?? ""))).length : 0;
    } catch {
      return 0;
    }
  };
  const list = results
    .map((r) => ({ docId: r.doc_id, fileName: r.file_name, code: r.code, syllabusId: r.syllabus_id, open: open(r), readAt: r.read_at, score: r }))
    .filter((r) => r.open > 0)
    .sort((a, b) => b.open - a.open);
  return { list: list.slice(0, limit), total: list.length, read: all?.n ?? 0 };
}
