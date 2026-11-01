// Agent runs are rows in `job` (type 'agent'). Start, claim, finish, list.
import { AGENT } from "../config.ts";
import type { Db } from "../db.ts";
import { randomId } from "../auth/crypto.ts";
import { audit } from "../auth/session.ts";
import type { LibrarySettings } from "../settings.ts";

export type RunMode = "dry" | "download";
export type RunSession = "m" | "s" | "w" | "y";
export type RunParams = { code: string; years: number[]; sessions: RunSession[]; mode: RunMode };

const SESSIONS: readonly RunSession[] = ["m", "s", "w", "y"];

/** Checks run choices against the library settings. Untrusted input in, clean params out. */
export function checkRunParams(input: { code: unknown; years: unknown[]; sessions: unknown[]; mode: unknown }, lib: LibrarySettings): RunParams | null {
  if (input.code !== "0625") return null;
  if (input.mode !== "dry" && input.mode !== "download") return null;
  const years = [...new Set(input.years.map((y) => Number(y)))].filter((y) => Number.isInteger(y) && y >= lib.fromYear && y <= lib.toYear);
  const sessions = [...new Set(input.sessions)].filter((s): s is RunSession => SESSIONS.includes(s as RunSession));
  if (years.length === 0 || years.length !== input.years.length || sessions.length === 0 || sessions.length !== input.sessions.length) return null;
  return { code: "0625", years: years.sort((a, b) => b - a), sessions: SESSIONS.filter((s) => sessions.includes(s)), mode: input.mode };
}

/**
 * Starts a run unless one is already queued or running (checked inside the insert,
 * so two clicks cannot start two runs). Old stuck runs are closed first.
 */
export async function startRun(db: Db, params: RunParams, actorId: string, now = Date.now()): Promise<string | null> {
  await db
    .prepare(`UPDATE job SET status = 'failed', error_ref = 'timeout', finished_at = ?1
              WHERE type = 'agent' AND status IN ('queued', 'running') AND created_at <= ?2`)
    .bind(now, now - AGENT.staleAfterMs)
    .run();
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
    .prepare(`UPDATE job SET status = 'running', started_at = COALESCE(started_at, ?2)
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

export type RunRow = { id: string; status: string; params: string; result: string; error_ref: string | null; created_at: number; finished_at: number | null };

export async function listRuns(db: Db, limit = 20): Promise<RunRow[]> {
  const { results } = await db
    .prepare(`SELECT id, status, params, result, error_ref, created_at, finished_at FROM job WHERE type = 'agent' ORDER BY created_at DESC LIMIT ?1`)
    .bind(limit)
    .all<RunRow>();
  return results;
}

export async function getRun(db: Db, id: string): Promise<RunRow | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return null;
  return db
    .prepare(`SELECT id, status, params, result, error_ref, created_at, finished_at FROM job WHERE id = ?1 AND type = 'agent'`)
    .bind(id)
    .first<RunRow>();
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
