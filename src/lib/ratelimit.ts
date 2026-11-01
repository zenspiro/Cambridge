// One rate limiter for every write (brief 15.2). Counts in one atomic write,
// before the work is done, so a burst of parallel requests cannot get past it.
// Uses the login_attempt table (key, attempts, window_start) for every kind of limit.
import type { Db } from "./db.ts";
import { sha256Hex } from "./auth/crypto.ts";

const COUNT = `
INSERT INTO login_attempt (key, attempts, window_start) VALUES (?1, 1, ?2)
ON CONFLICT (key) DO UPDATE SET
  attempts     = CASE WHEN login_attempt.window_start <= ?2 - ?3 THEN 1  ELSE login_attempt.attempts + 1 END,
  window_start = CASE WHEN login_attempt.window_start <= ?2 - ?3 THEN ?2 ELSE login_attempt.window_start END
RETURNING attempts`;

const CLEAR = `DELETE FROM login_attempt WHERE key = ?1`;

/** Hashed so no raw IPs or ids sit in the table. */
export function limitKey(kind: string, who: string): Promise<string> {
  return sha256Hex(`${kind}:${who}`);
}

/** Counts one hit. Returns the count in this window, so callers know if this one is over. */
export async function hit(db: Db, key: string, windowMs: number, now = Date.now()): Promise<number> {
  const row = await db.prepare(COUNT).bind(key, now, windowMs).first<{ attempts: number }>();
  return row?.attempts ?? Number.MAX_SAFE_INTEGER;
}

/** True while under the limit (this hit included). */
export async function allow(db: Db, key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  return (await hit(db, key, windowMs, now)) <= limit;
}

export async function clear(db: Db, key: string): Promise<void> {
  await db.prepare(CLEAR).bind(key).run();
}
