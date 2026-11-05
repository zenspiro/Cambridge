// Agent runs are rows in `job` (type 'agent'). Start, claim, finish, list.
import { AGENT } from "../config.ts";
import type { Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import type { LibrarySettings } from "../settings.ts";
import { parseCambridgeName } from "../library/names.ts";

/** dry: list only; download: fetch missing files; check: read the first page of stored files. */
export type RunMode = "dry" | "download" | "check";
export type RunSession = "m" | "s" | "w" | "y";
export type RunParams = { code: string; years: number[]; sessions: RunSession[]; mode: RunMode };

const SESSIONS: readonly RunSession[] = ["m", "s", "w", "y"];

/** Checks run choices against the library settings. Untrusted input in, clean params out. */
export function checkRunParams(
  input: { code: unknown; years: unknown[]; sessions: unknown[]; mode: unknown },
  lib: LibrarySettings,
  codes: readonly string[],
): RunParams | null {
  if (typeof input.code !== "string" || !codes.includes(input.code)) return null;
  const code = input.code;
  if (input.mode !== "dry" && input.mode !== "download" && input.mode !== "check") return null;
  // Nothing ticked means everything (owner decision 5 Nov 2026): every library year, every session.
  const allYears: number[] = [];
  for (let y = lib.toYear; y >= lib.fromYear; y--) allYears.push(y);
  const years = input.years.length === 0 ? allYears
    : [...new Set(input.years.map((y) => Number(y)))].filter((y) => Number.isInteger(y) && y >= lib.fromYear && y <= lib.toYear);
  const sessions = input.sessions.length === 0 ? [...SESSIONS]
    : [...new Set(input.sessions)].filter((s): s is RunSession => SESSIONS.includes(s as RunSession));
  if (years.length === 0 || (input.years.length && years.length !== input.years.length) || sessions.length === 0 || (input.sessions.length && sessions.length !== input.sessions.length)) return null;
  return { code, years: years.sort((a, b) => b - a), sessions: SESSIONS.filter((s) => sessions.includes(s)), mode: input.mode };
}

/**
 * Closes runs with no sign of life for AGENT.staleAfterMs: never started by GitHub,
 * or started and gone quiet. Called before a new run starts and when run pages load.
 */
export async function closeStaleRuns(db: Db, now = Date.now()): Promise<void> {
  await db
    .prepare(`UPDATE job SET status = 'failed', error_ref = CASE status WHEN 'queued' THEN 'never_started' ELSE 'timeout' END,
                     finished_at = ?1
              WHERE type = 'agent' AND status IN ('queued', 'running')
                AND COALESCE(heartbeat_at, started_at, created_at) <= ?2`)
    .bind(now, now - AGENT.staleAfterMs)
    .run();
}

/**
 * Starts a run unless one is already queued or running (checked inside the insert,
 * so two clicks cannot start two runs). Stale runs are closed first.
 */
export async function startRun(db: Db, params: RunParams, actorId: string, now = Date.now()): Promise<string | null> {
  await closeStaleRuns(db, now);
  const row = await db
    .prepare(`INSERT INTO job (id, type, status, params, created_by, created_at)
              SELECT ?1, 'agent', 'queued', ?2, ?3, ?4
              WHERE NOT EXISTS (SELECT 1 FROM job WHERE type = 'agent' AND status IN ('queued', 'running'))
              RETURNING id`)
    .bind(randomId(), JSON.stringify(params), actorId, now)
    .first<{ id: string }>();
  if (row) await audit(db, { actorId, action: `agent.start_${params.mode}`, entity: "job", entityId: row.id }, now);
  return row?.id ?? null;
}

/** The agent picks up its run. Queued becomes running; a running run can be picked up again (retry). */
export async function claimRun(db: Db, id: string, now = Date.now()): Promise<RunParams | null> {
  const row = await db
    .prepare(`UPDATE job SET status = 'running', started_at = COALESCE(started_at, ?2), heartbeat_at = ?2
              WHERE id = ?1 AND type = 'agent' AND status IN ('queued', 'running') RETURNING params`)
    .bind(id, now)
    .first<{ params: string }>();
  return row ? (JSON.parse(row.params) as RunParams) : null;
}

export async function activeRun(db: Db, id: string): Promise<RunParams | null> {
  const row = await db
    .prepare(`SELECT params FROM job WHERE id = ?1 AND type = 'agent' AND status = 'running'`)
    .bind(id)
    .first<{ params: string }>();
  return row ? (JSON.parse(row.params) as RunParams) : null;
}

export async function finishRun(db: Db, id: string, ok: boolean, report: string, errorRef: string | null, now = Date.now()) {
  const row = await db
    .prepare(`UPDATE job SET status = ?2, result = ?3, error_ref = ?4, progress = 100, finished_at = ?5
              WHERE id = ?1 AND type = 'agent' AND status IN ('queued', 'running') RETURNING created_by`)
    .bind(id, ok ? "succeeded" : "failed", report, errorRef, now)
    .first<{ created_by: string | null }>();
  if (row) await audit(db, { actorId: "agent", action: ok ? "agent.finish" : "agent.fail", entity: "job", entityId: id }, now);
  return !!row;
}

/** One activity line. With a file, the run page describes it in words using the paper names. */
export type RunEvent = {
  at: number;
  text: string;
  file?: string;
  outcome?: "stored" | "failed" | "found";
  reason?: string;
  bytes?: number;
};
export type EventInput = Omit<RunEvent, "at">;

/** Checks an event from the agent: plain text, or text with a Cambridge file name and outcome. */
export function cleanEvent(v: unknown): EventInput | null {
  if (typeof v === "string") {
    const text = cleanEventText(v);
    return text ? { text } : null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const text = cleanEventText(o.text);
  if (!text) return null;
  const out: EventInput = { text };
  const f = typeof o.file === "string" ? parseCambridgeName(o.file) : null;
  if (f) out.file = f.fileName;
  if (o.outcome === "stored" || o.outcome === "failed" || o.outcome === "found") out.outcome = o.outcome;
  const reason = typeof o.reason === "string" && /^[a-z0-9_]{1,40}$/.test(o.reason) ? o.reason : null;
  if (reason) out.reason = reason;
  if (typeof o.bytes === "number" && Number.isInteger(o.bytes) && o.bytes >= 0 && o.bytes < 1e10) out.bytes = o.bytes;
  return out;
}
export type RunRow = {
  id: string; status: string; params: string; result: string; error_ref: string | null; created_at: number;
  started_at: number | null; finished_at: number | null; heartbeat_at: number | null; progress: number;
  step: string | null; events: string; run_url: string | null;
};
const RUN_COLS = `id, status, params, result, error_ref, created_at, started_at, finished_at, heartbeat_at, progress, step, events, run_url`;

export async function listRuns(db: Db, limit = 20): Promise<RunRow[]> {
  const { results } = await db
    .prepare(`SELECT ${RUN_COLS} FROM job WHERE type = 'agent' ORDER BY created_at DESC LIMIT ?1`)
    .bind(limit)
    .all<RunRow>();
  return results;
}

export async function getRun(db: Db, id: string): Promise<RunRow | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return null;
  return db
    .prepare(`SELECT ${RUN_COLS} FROM job WHERE id = ?1 AND type = 'agent'`)
    .bind(id)
    .first<RunRow>();
}

/** Short single-line text from the agent: no control characters, capped. Shown as text only. */
export function cleanEventText(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** Only a link to this repository's own Actions run log is kept. */
export function cleanRunUrl(v: unknown, repo: string | undefined): string | null {
  if (typeof v !== "string" || !repo) return null;
  const re = new RegExp(`^https://github\\.com/${repo.replace(/[.]/g, "\\.")}/actions/runs/\\d{1,20}$`);
  return re.test(v) ? v : null;
}

/**
 * The agent's sign of life: progress (0 to 100), current step, and an optional event
 * for the live log (last AGENT.maxEvents kept). False when the run is no longer active
 * (finished, cancelled or closed), which tells the agent to stop.
 */
export async function recordProgress(
  db: Db,
  id: string,
  update: { progress: number; step: string | null; event: EventInput | string | null; runUrl: string | null },
  now = Date.now(),
): Promise<boolean> {
  const row = await db.prepare(`SELECT events FROM job WHERE id = ?1 AND type = 'agent' AND status = 'running'`).bind(id).first<{ events: string }>();
  if (!row) return false;
  let events: RunEvent[] = [];
  try {
    events = JSON.parse(row.events) as RunEvent[];
  } catch {
    events = [];
  }
  const ev = typeof update.event === "string" ? cleanEvent(update.event) : update.event;
  if (ev) events = [...events, { at: now, ...ev }].slice(-AGENT.maxEvents);
  const pct = Math.max(0, Math.min(99, Math.round(update.progress)));
  const done = await db
    .prepare(`UPDATE job SET progress = ?2, step = COALESCE(?3, step), events = ?4, heartbeat_at = ?5, run_url = COALESCE(run_url, ?6)
              WHERE id = ?1 AND type = 'agent' AND status = 'running' RETURNING id`)
    .bind(id, pct, update.step, JSON.stringify(events), now, update.runUrl)
    .first<{ id: string }>();
  return !!done;
}

/** Admin stops a run. The agent sees it on its next update and stops too. */
export async function cancelRun(db: Db, id: string, actorId: string, now = Date.now()): Promise<boolean> {
  const row = await db
    .prepare(`UPDATE job SET status = 'cancelled', error_ref = 'cancelled', finished_at = ?2
              WHERE id = ?1 AND type = 'agent' AND status IN ('queued', 'running') RETURNING id`)
    .bind(id, now)
    .first<{ id: string }>();
  if (row) await audit(db, { actorId, action: "agent.cancel", entity: "job", entityId: id }, now);
  return !!row;
}

/** Spends a signed request's nonce once. False means a replay. */
export async function spendNonce(db: Db, nonce: string, now = Date.now()): Promise<boolean> {
  await db
    .prepare(`DELETE FROM request_nonce WHERE nonce IN (SELECT nonce FROM request_nonce WHERE at < ?1 LIMIT 200)`)
    .bind(now - 15 * 60_000)
    .run();
  const row = await db
    .prepare(`INSERT INTO request_nonce (nonce, at) VALUES (?1, ?2) ON CONFLICT DO NOTHING RETURNING nonce`)
    .bind(nonce, now)
    .first<{ nonce: string }>();
  return !!row;
}
