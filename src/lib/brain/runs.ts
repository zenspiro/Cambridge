// Topic tree runs: rows in `job` (type 'brain', params { task: 'topics', syllabusId }), started from the admin
// panel, carried out on GitHub Actions (scripts/brain/run.ts), saved into `topic_tree`. Takes the database as a
// parameter (unit tested on SQLite). No Next imports.
import { BRAIN } from "../config.ts";
import type { Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import { checkNumbers, cleanDraft, isReady, type Disagreement, type Draft, type Problem, type TreeReport } from "./topics.ts";

export type PaperScope = { items: string[]; figures: string[] };
export type BrainParams =
  | { task: "topics"; syllabusId: string }
  | { task: "check"; which: "claude" | "gemini" | null }
  | { task: "paper"; docId: string; scope: PaperScope; batch?: Batch };
/** Read all (owner, 8 Nov 2026): one run reads these papers in turn; `docId` is the one being read now. */
export type Batch = { docs: string[]; label: string };
export type TreeStatus = "none" | "ready" | "not_ready";
export type RunState = { id: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; step: string | null; errorRef: string | null; createdAt: number; finishedAt: number | null };

/** The stored syllabus PDF of a version, if any. */
export async function syllabusPdf(db: Db, syllabusId: string): Promise<{ r2Key: string; fileName: string; bytes: number } | null> {
  const r = await db
    .prepare(`SELECT r2_key, file_name, size_bytes FROM source_document WHERE syllabus_id = ?1 AND doc_type = 'sy' AND status = 'stored' ORDER BY acquired_at DESC LIMIT 1`)
    .bind(syllabusId)
    .first<{ r2_key: string; file_name: string; size_bytes: number }>();
  return r ? { r2Key: r.r2_key, fileName: r.file_name, bytes: r.size_bytes } : null;
}

/** Runs with no sign of life for BRAIN.staleAfterMs are closed (GitHub never started them, or they went quiet). */
export async function closeStaleBrainRuns(db: Db, now = Date.now()): Promise<void> {
  await db
    .prepare(`UPDATE job SET status = 'failed', error_ref = CASE status WHEN 'queued' THEN 'never_started' ELSE 'timeout' END, finished_at = ?1
              WHERE type = 'brain' AND status IN ('queued', 'running') AND COALESCE(heartbeat_at, started_at, created_at) <= ?2`)
    .bind(now, now - BRAIN.staleAfterMs)
    .run();
}

/** Starts a brain run unless one is active (checked inside the insert, so two clicks start one). */
async function startBrainRun(db: Db, params: BrainParams, actorId: string, now: number): Promise<string | null> {
  await closeStaleBrainRuns(db, now);
  const row = await db
    .prepare(`INSERT INTO job (id, type, status, params, created_by, created_at)
              SELECT ?1, 'brain', 'queued', ?2, ?3, ?4
              WHERE NOT EXISTS (SELECT 1 FROM job WHERE type = 'brain' AND status IN ('queued', 'running'))
              RETURNING id`)
    .bind(randomId(), JSON.stringify(params), actorId, now)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** "Check Claude" or "Check Gemini" (null: both): one brain run that lists and tries the models (aiSetup.ts). */
export async function startCheckRun(db: Db, actorId: string, which: "claude" | "gemini" | null = null, now = Date.now()): Promise<string | null> {
  const id = await startBrainRun(db, { task: "check", which }, actorId, now);
  if (id) await audit(db, { actorId, action: "brain.check_start", entity: "job", entityId: id, detail: { which: which ?? "both" } }, now);
  return id;
}

/** The latest AI setup check run, for its page. */
export async function lastCheckRun(db: Db, now = Date.now()): Promise<RunState | null> {
  await closeStaleBrainRuns(db, now);
  const r = await db
    .prepare(`SELECT id, status, step, error_ref, created_at, finished_at FROM job WHERE type = 'brain' AND json_extract(params, '$.task') = 'check' ORDER BY created_at DESC LIMIT 1`)
    .bind()
    .first<{ id: string; status: RunState["status"]; step: string | null; error_ref: string | null; created_at: number; finished_at: number | null }>();
  return r ? { id: r.id, status: r.status, step: r.step, errorRef: r.error_ref, createdAt: r.created_at, finishedAt: r.finished_at } : null;
}

/** Finishes a running check run (its result is saved by saveCheck in aiSetup.ts). */
export async function finishCheckRun(db: Db, id: string, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare(`UPDATE job SET status = 'succeeded', progress = 100, finished_at = ?2, step = NULL
              WHERE id = ?1 AND type = 'brain' AND status = 'running' AND json_extract(params, '$.task') = 'check' RETURNING id`)
    .bind(id, now)
    .first();
  return !!row;
}

/**
 * "Read this paper" (or read one question again, or redraw one figure): a brain run for one question paper or mark
 * scheme. An empty scope reads the whole paper (keeping what is confirmed).
 */
export async function startPaperRun(db: Db, docId: string, scope: PaperScope, actorId: string, now = Date.now()): Promise<string | null> {
  const id = await startBrainRun(db, { task: "paper", docId, scope }, actorId, now);
  if (!id) return null;
  await db
    .prepare(`INSERT INTO paper_read (doc_id, job_id, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (doc_id) DO UPDATE SET job_id = ?2, updated_at = ?3`)
    .bind(docId, id, now)
    .run();
  await audit(db, { actorId, action: "brain.paper_start", entity: "source_document", entityId: docId, detail: { job: id, items: scope.items.length, figures: scope.figures.length } }, now);
  return id;
}

const DOC_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;

/** Read all: one run for many papers, the first one claimed now (each later one when the script asks for it). */
export async function startBatchRun(db: Db, docs: readonly string[], label: string, actorId: string, now = Date.now()): Promise<string | null> {
  const list = docs.filter((d) => DOC_ID_RE.test(d)).slice(0, BRAIN.maxBatchPapers);
  if (!list.length) return null;
  const id = await startBrainRun(db, { task: "paper", docId: list[0]!, scope: { items: [], figures: [] }, batch: { docs: list, label: label.slice(0, 120) } }, actorId, now);
  if (!id) return null;
  await claimPaper(db, list[0]!, id, now);
  await audit(db, { actorId, action: "brain.batch_start", entity: "job", entityId: id, detail: { papers: list.length, label: label.slice(0, 120) } }, now);
  return id;
}

const claimPaper = (db: Db, docId: string, jobId: string, now: number) => db
  .prepare(`INSERT INTO paper_read (doc_id, job_id, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (doc_id) DO UPDATE SET job_id = ?2, updated_at = ?3`)
  .bind(docId, jobId, now)
  .run();

/** Where a batch stands: the paper being read (1-based) of how many. */
export const batchPlace = (p: BrainParams | null) => (p?.task === "paper" && p.batch ? { at: p.batch.docs.indexOf(p.docId) + 1, of: p.batch.docs.length } : null);

/**
 * The next paper of a running batch that is still not read (a paper read meanwhile is skipped), made the run's
 * current paper. Null when none is left: the run is closed as done.
 */
export async function nextBatchPaper(db: Db, jobId: string, now = Date.now()): Promise<string | null> {
  const p = await activeBrainRun(db, jobId);
  if (p?.task !== "paper" || !p.batch) return null;
  const rest = p.batch.docs.slice(p.batch.docs.indexOf(p.docId) + 1);
  for (const docId of rest) {
    const done = await db.prepare(`SELECT read_at FROM paper_read WHERE doc_id = ?1`).bind(docId).first<{ read_at: number | null }>();
    if (done?.read_at) continue;
    const row = await db
      .prepare(`UPDATE job SET params = ?2, heartbeat_at = ?3 WHERE id = ?1 AND type = 'brain' AND status = 'running' RETURNING id`)
      .bind(jobId, JSON.stringify({ ...p, docId }), now)
      .first();
    if (!row) return null;
    await claimPaper(db, docId, jobId, now);
    return docId;
  }
  await finishBatchRun(db, jobId, now);
  return null;
}

/** A batch with nothing left to read is done. */
export async function finishBatchRun(db: Db, jobId: string, now = Date.now()): Promise<void> {
  const row = await db
    .prepare(`UPDATE job SET status = 'succeeded', progress = 100, finished_at = ?2, step = NULL WHERE id = ?1 AND type = 'brain' AND status = 'running' RETURNING id`)
    .bind(jobId, now)
    .first();
  if (row) await audit(db, { actorId: "brain", action: "brain.batch_done", entity: "job", entityId: jobId }, now);
}

/** A brain run's state for its page (and the live progress panel). */
export async function runState(db: Db, id: string, now = Date.now()): Promise<(RunState & { events: RunEvent[]; task: string; params: BrainParams | null }) | null> {
  await closeStaleBrainRuns(db, now);
  const r = await db
    .prepare(`SELECT id, status, step, error_ref, created_at, finished_at, events, params FROM job WHERE id = ?1 AND type = 'brain'`)
    .bind(id)
    .first<{ id: string; status: RunState["status"]; step: string | null; error_ref: string | null; created_at: number; finished_at: number | null; events: string | null; params: string }>();
  if (!r) return null;
  return {
    id: r.id, status: r.status, step: r.step, errorRef: r.error_ref, createdAt: r.created_at, finishedAt: r.finished_at,
    events: cleanEvents(r.events), task: readParams(r.params)?.task ?? "", params: readParams(r.params),
  };
}

export type BatchPaper = { docId: string; fileName: string; syllabusId: string; read: boolean; flags: number };

/**
 * Read all's papers for the live card (owner, 9 Nov 2026: the status where the read was started): each paper of the
 * batch, whether this run has read it yet (a reading saved since the run began) and how many flags it has open.
 */
export async function batchPapers(db: Db, docs: readonly string[], since: number): Promise<BatchPaper[]> {
  if (!docs.length) return [];
  const { results } = await db
    .prepare(`SELECT d.id, d.file_name, d.syllabus_id, p.read_at, p.flags, p.dismissed FROM source_document d LEFT JOIN paper_read p ON p.doc_id = d.id
              WHERE d.id IN (SELECT value FROM json_each(?1))`)
    .bind(JSON.stringify(docs))
    .all<{ id: string; file_name: string; syllabus_id: string; read_at: number | null; flags: string | null; dismissed: string | null }>();
  const byId = new Map(results.map((r) => [r.id, r]));
  const open = (flags: string | null, dismissed: string | null) => {
    try {
      const f = JSON.parse(flags ?? "[]") as { fingerprint?: string }[];
      const gone = new Set(JSON.parse(dismissed ?? "[]") as string[]);
      return Array.isArray(f) ? f.filter((x) => !gone.has(String(x?.fingerprint ?? ""))).length : 0;
    } catch {
      return 0;
    }
  };
  return docs.flatMap((id) => {
    const r = byId.get(id);
    return r ? [{ docId: id, fileName: r.file_name, syllabusId: r.syllabus_id, read: (r.read_at ?? 0) >= since, flags: open(r.flags, r.dismissed) }] : [];
  });
}

/** The latest Read all of a subject: running, or finished within `recentMs`; null otherwise. */
export async function latestBatch(db: Db, code: string, now = Date.now(), recentMs = 30 * 60_000): Promise<{ id: string; active: boolean } | null> {
  const { results } = await db
    .prepare(`SELECT id, status, finished_at, params FROM job WHERE type = 'brain' AND created_at >= ?1 ORDER BY created_at DESC LIMIT 20`)
    .bind(now - 86_400_000)
    .all<{ id: string; status: string; finished_at: number | null; params: string }>();
  for (const r of results) {
    const p = readParams(r.params);
    if (p?.task !== "paper" || !p.batch || !p.batch.label.startsWith(`${code} `)) continue;
    const active = r.status === "queued" || r.status === "running";
    return active || (r.finished_at ?? 0) >= now - recentMs ? { id: r.id, active } : null;
  }
  return null;
}

// ---------- Live progress (owner, 7 Nov 2026: real progress per model, not a page that reloads) ----------

export type RunStage = "pdf" | "gemini" | "claude" | "retry" | "figures" | "drawing" | "checks" | "save";
export type RunEvent = { at: number; stage: RunStage; state: "start" | "wait" | "done" | "fail" | "skip"; text: string; model: string; tokens: number };
const STAGES: readonly RunStage[] = ["pdf", "gemini", "claude", "retry", "figures", "drawing", "checks", "save"];
const STATES = ["start", "wait", "done", "fail", "skip"] as const;

/** One progress event from the script, made safe. Null when it is not one. */
export function cleanEvent(v: unknown, now: number): RunEvent | null {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const stage = STAGES.find((s) => s === o.stage);
  const state = STATES.find((s) => s === o.state);
  if (!stage || !state) return null;
  const text = typeof o.text === "string" ? o.text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) : "";
  const model = typeof o.model === "string" && /^[a-z0-9][a-z0-9.-]{0,60}$/.test(o.model) ? o.model : "";
  const tokens = typeof o.tokens === "number" && Number.isInteger(o.tokens) && o.tokens >= 0 ? Math.min(o.tokens, 50_000_000) : 0;
  return { at: now, stage, state, text, model, tokens };
}

function cleanEvents(s: string | null): RunEvent[] {
  try {
    const v = JSON.parse(s ?? "[]") as unknown[];
    return Array.isArray(v) ? v.flatMap((e) => {
      const c = cleanEvent(e, typeof (e as RunEvent)?.at === "number" ? (e as RunEvent).at : 0);
      return c ? [c] : [];
    }) : [];
  } catch {
    return [];
  }
}

export async function startTreeRun(db: Db, syllabusId: string, actorId: string, now = Date.now()): Promise<string | null> {
  const id = await startBrainRun(db, { task: "topics", syllabusId }, actorId, now);
  if (!id) return null;
  const row = { id };
  await db
    .prepare(`INSERT INTO topic_tree (syllabus_id, job_id, updated_at) VALUES (?1, ?2, ?3)
              ON CONFLICT (syllabus_id) DO UPDATE SET job_id = ?2, updated_at = ?3`)
    .bind(syllabusId, row.id, now)
    .run();
  await audit(db, { actorId, action: "brain.topics_start", entity: "syllabus", entityId: syllabusId, detail: { job: row.id } }, now);
  return row.id;
}

const readParams = (s: string): BrainParams | null => {
  try {
    const p = JSON.parse(s) as BrainParams;
    if (p?.task === "check") return { task: "check", which: p.which === "claude" || p.which === "gemini" ? p.which : null };
    if (p?.task === "paper" && typeof p.docId === "string") {
      const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 100) : []);
      const sc = (p.scope ?? {}) as { items?: unknown; figures?: unknown };
      const b = (p as { batch?: { docs?: unknown; label?: unknown } }).batch;
      const docs = b && Array.isArray(b.docs) ? b.docs.filter((x): x is string => typeof x === "string" && DOC_ID_RE.test(x)).slice(0, BRAIN.maxBatchPapers) : [];
      const batch = docs.includes(p.docId) ? { docs, label: typeof b?.label === "string" ? b.label.slice(0, 120) : "" } : undefined;
      return { task: "paper", docId: p.docId, scope: { items: list(sc.items), figures: list(sc.figures) }, ...(batch ? { batch } : {}) };
    }
    return p?.task === "topics" && typeof p.syllabusId === "string" ? { task: "topics", syllabusId: p.syllabusId } : null;
  } catch {
    return null;
  }
};

/** The script picks up its run: queued becomes running (a running run may be picked up again). */
export async function claimBrainRun(db: Db, id: string, runUrl: string | null, now = Date.now()): Promise<BrainParams | null> {
  const row = await db
    .prepare(`UPDATE job SET status = 'running', started_at = COALESCE(started_at, ?2), heartbeat_at = ?2, run_url = COALESCE(?3, run_url)
              WHERE id = ?1 AND type = 'brain' AND status IN ('queued', 'running') RETURNING params`)
    .bind(id, now, runUrl)
    .first<{ params: string }>();
  return row ? readParams(row.params) : null;
}

export async function activeBrainRun(db: Db, id: string): Promise<BrainParams | null> {
  const row = await db.prepare(`SELECT params FROM job WHERE id = ?1 AND type = 'brain' AND status = 'running'`).bind(id).first<{ params: string }>();
  return row ? readParams(row.params) : null;
}

/**
 * One plain-word step ("Claude is reading the syllabus") and a heartbeat, plus a progress event for the live panel
 * (kept to the last BRAIN.maxRunEvents). False when the run is no longer running.
 */
export async function brainStep(db: Db, id: string, step: string, now = Date.now(), event: RunEvent | null = null): Promise<boolean> {
  const row = event
    ? await db
      .prepare(`UPDATE job SET step = ?2, heartbeat_at = ?3,
                  events = (SELECT json_group_array(json(value)) FROM (
                              SELECT value FROM json_each(json_insert(COALESCE(events, '[]'), '$[#]', json(?4)))
                              WHERE key >= json_array_length(COALESCE(events, '[]')) + 1 - ?5 ORDER BY key))
                WHERE id = ?1 AND type = 'brain' AND status = 'running' RETURNING id`)
      .bind(id, step.slice(0, 200), now, JSON.stringify(event), BRAIN.maxRunEvents)
      .first()
    : await db
      .prepare(`UPDATE job SET step = ?2, heartbeat_at = ?3 WHERE id = ?1 AND type = 'brain' AND status = 'running' RETURNING id`)
      .bind(id, step.slice(0, 200), now)
      .first();
  return !!row;
}

export async function failBrainRun(db: Db, id: string, errorRef: string, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare(`UPDATE job SET status = 'failed', error_ref = ?2, progress = 100, finished_at = ?3
              WHERE id = ?1 AND type = 'brain' AND status IN ('queued', 'running') RETURNING id`)
    .bind(id, errorRef.slice(0, 60), now)
    .first();
  if (row) await audit(db, { actorId: "brain", action: "brain.fail", entity: "job", entityId: id, detail: { reason: errorRef.slice(0, 60) } }, now);
  return !!row;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** A report from the script made safe: known fields only, capped. */
export function cleanReport(v: unknown): TreeReport {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const list = <T>(x: unknown, f: (r: Record<string, unknown>) => T): T[] =>
    (Array.isArray(x) ? x : []).slice(0, BRAIN.maxReportItems).map((r) => f(r && typeof r === "object" ? (r as Record<string, unknown>) : {}));
  const kinds = ["words", "numbers", "missing", "shape"] as const;
  const problems: Problem[] = list(o.problems, (r) => ({
    kind: kinds.find((k) => k === r.kind) ?? "shape",
    where: str(r.where, 200),
    detail: str(r.detail, 300),
  }));
  const disagreements: Disagreement[] = list(o.disagreements, (r) => ({ where: str(r.where, 200), claude: str(r.claude, 600), gemini: str(r.gemini, 600) }));
  const m = o.models && typeof o.models === "object" ? (o.models as Record<string, unknown>) : {};
  const u = o.usage && typeof o.usage === "object" ? (o.usage as Record<string, unknown>) : {};
  return {
    attempts: Math.min(num(o.attempts), BRAIN.attempts),
    textChecked: o.textChecked === true,
    problems,
    agreement: Math.min(num(o.agreement), 1),
    disagreements,
    settled: num(o.settled),
    models: { claude: str(m.claude, 80), gemini: str(m.gemini, 80) },
    usage: { claudeIn: num(u.claudeIn), claudeOut: num(u.claudeOut), geminiIn: num(u.geminiIn), geminiOut: num(u.geminiOut) },
  };
}

export type SaveResult = "ok_ready" | "ok_not_ready" | "no_run" | "too_big" | "empty";

/**
 * Saves the run's tree. The draft is cleaned and its numbering checked again here (the word check needs the PDF's
 * text, which only the script has). Ready only when the report and this check agree; otherwise it is stored as
 * not ready, so later steps do not use it.
 */
export async function saveTree(db: Db, jobId: string, rawDraft: unknown, rawReport: unknown, now = Date.now()): Promise<SaveResult> {
  const params = await activeBrainRun(db, jobId);
  if (!params || params.task !== "topics") return "no_run";
  const { draft, problems: shape } = cleanDraft(rawDraft);
  if (!draft.topics.length) return "empty";
  const report = cleanReport(rawReport);
  const own = [...shape, ...checkNumbers(draft)];
  for (const p of own) if (!report.problems.some((q) => q.where === p.where && q.detail === p.detail)) report.problems.push(p);
  report.problems = report.problems.slice(0, BRAIN.maxReportItems);
  const tree = JSON.stringify(draft);
  const rep = JSON.stringify(report);
  if (tree.length + rep.length > BRAIN.maxTreeBytes) return "too_big";
  const status: TreeStatus = isReady(report) ? "ready" : "not_ready";
  await db
    .prepare(`INSERT INTO topic_tree (syllabus_id, status, job_id, tree, report, topics, goals, drafted_at, updated_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
              ON CONFLICT (syllabus_id) DO UPDATE SET status = ?2, job_id = ?3, tree = ?4, report = ?5, topics = ?6, goals = ?7, drafted_at = ?8, updated_at = ?8`)
    .bind(params.syllabusId, status, jobId, tree, rep, draft.topics.length, draft.goals.length, now)
    .run();
  await db
    .prepare(`UPDATE job SET status = 'succeeded', progress = 100, finished_at = ?2, step = NULL WHERE id = ?1 AND type = 'brain' AND status = 'running'`)
    .bind(jobId, now)
    .run();
  await audit(db, { actorId: "brain", action: "brain.topics_saved", entity: "syllabus", entityId: params.syllabusId, detail: { status, topics: draft.topics.length, goals: draft.goals.length } }, now);
  return status === "ready" ? "ok_ready" : "ok_not_ready";
}

export type TreeRow = {
  syllabusId: string;
  code: string;
  fromYear: number;
  toYear: number;
  status: TreeStatus;
  topics: number;
  goals: number;
  draftedAt: number | null;
  run: RunState | null;
  pdf: string | null;
  pdfBytes: number;
};

type Row = {
  id: string; code: string; valid_from_year: number; valid_to_year: number;
  status: TreeStatus | null; topics: number | null; goals: number | null; drafted_at: number | null;
  job_id: string | null; job_status: RunState["status"] | null; step: string | null; error_ref: string | null; job_created: number | null; job_finished: number | null;
  pdf: string | null; pdf_bytes: number | null;
};

const SELECT_ROWS = `
SELECT y.id, y.code, y.valid_from_year, y.valid_to_year, t.status, t.topics, t.goals, t.drafted_at,
       j.id AS job_id, j.status AS job_status, j.step, j.error_ref, j.created_at AS job_created, j.finished_at AS job_finished,
       (SELECT d.file_name FROM source_document d WHERE d.syllabus_id = y.id AND d.doc_type = 'sy' AND d.status = 'stored' ORDER BY d.acquired_at DESC LIMIT 1) AS pdf,
       (SELECT d.size_bytes FROM source_document d WHERE d.syllabus_id = y.id AND d.doc_type = 'sy' AND d.status = 'stored' ORDER BY d.acquired_at DESC LIMIT 1) AS pdf_bytes
FROM syllabus y LEFT JOIN topic_tree t ON t.syllabus_id = y.id LEFT JOIN job j ON j.id = t.job_id`;

const toRow = (r: Row): TreeRow => ({
  syllabusId: r.id,
  code: r.code,
  fromYear: r.valid_from_year,
  toYear: r.valid_to_year,
  status: r.status ?? "none",
  topics: r.topics ?? 0,
  goals: r.goals ?? 0,
  draftedAt: r.drafted_at,
  run: r.job_id && r.job_status && r.job_created !== null
    ? { id: r.job_id, status: r.job_status, step: r.step, errorRef: r.error_ref, createdAt: r.job_created, finishedAt: r.job_finished }
    : null,
  pdf: r.pdf,
  pdfBytes: r.pdf_bytes ?? 0,
});

/** Every version of a syllabus code with its tree status, latest run and stored syllabus PDF. */
export async function treesForCode(db: Db, code: string, now = Date.now()): Promise<TreeRow[]> {
  await closeStaleBrainRuns(db, now);
  const { results } = await db.prepare(`${SELECT_ROWS} WHERE y.code = ?1 ORDER BY y.valid_from_year DESC`).bind(code).all<Row>();
  return results.map(toRow);
}

/** Every syllabus version of every subject, for the Topic trees overview. */
export async function allTrees(db: Db, now = Date.now()): Promise<TreeRow[]> {
  await closeStaleBrainRuns(db, now);
  const { results } = await db.prepare(`${SELECT_ROWS} ORDER BY y.code, y.valid_from_year DESC`).bind().all<Row>();
  return results.map(toRow);
}

export async function treeRow(db: Db, syllabusId: string, now = Date.now()): Promise<TreeRow | null> {
  await closeStaleBrainRuns(db, now);
  const r = await db.prepare(`${SELECT_ROWS} WHERE y.id = ?1`).bind(syllabusId).first<Row>();
  return r ? toRow(r) : null;
}

/** The stored tree and its report, for the tree page and for later steps (which use only ready trees). */
export async function loadTree(db: Db, syllabusId: string): Promise<{ status: TreeStatus; draft: Draft; report: TreeReport } | null> {
  const r = await db.prepare(`SELECT status, tree, report FROM topic_tree WHERE syllabus_id = ?1 AND tree IS NOT NULL`).bind(syllabusId).first<{ status: TreeStatus; tree: string; report: string | null }>();
  if (!r) return null;
  try {
    return { status: r.status, draft: cleanDraft(JSON.parse(r.tree)).draft, report: cleanReport(r.report ? JSON.parse(r.report) : {}) };
  } catch {
    return null;
  }
}

/** True while a run for this version is queued or running. */
export const isActive = (run: RunState | null) => run !== null && (run.status === "queued" || run.status === "running");
