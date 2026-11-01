// Background and batch jobs (brief 6, 15.5): every run is a row with status and result.
import type { Db } from "./db.ts";
import { randomId } from "./auth/crypto.ts";

export type JobRow = {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  params: string;
  result: string;
  error_ref: string | null;
  created_by: string | null;
  created_at: number;
  finished_at: number | null;
};

export async function createJob(db: Db, type: string, createdBy: string, params: object = {}, now = Date.now()) {
  const id = randomId();
  await db
    .prepare(`INSERT INTO job (id, type, status, params, created_by, created_at, started_at) VALUES (?1, ?2, 'running', ?3, ?4, ?5, ?5)`)
    .bind(id, type, JSON.stringify(params), createdBy, now)
    .run();
  return id;
}

export async function finishJob(
  db: Db,
  id: string,
  status: "succeeded" | "failed",
  result: object,
  errorRef: string | null = null,
  now = Date.now(),
) {
  await db
    .prepare(`UPDATE job SET status = ?2, result = ?3, error_ref = ?4, progress = 100, finished_at = ?5 WHERE id = ?1`)
    .bind(id, status, JSON.stringify(result), errorRef, now)
    .run();
}

export async function getJob(db: Db, id: string, type: string): Promise<JobRow | null> {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) return null;
  return db.prepare(`SELECT * FROM job WHERE id = ?1 AND type = ?2`).bind(id, type).first<JobRow>();
}
