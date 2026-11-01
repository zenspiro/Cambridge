// Admin sign-in logic on D1. Takes the database as a parameter, so unit tests
// run it against SQLite in Node. No Next imports here.
import { AUTH } from "../config.ts";
import type { Db } from "../db.ts";
import { clear, hit, limitKey } from "../ratelimit.ts";
import { randomId, randomToken, secretEquals, sha256Hex } from "./crypto.ts";
import * as Q from "./queries.ts";

export type { Db };

export type SignInResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; reason: "bad" | "locked" | "unavailable" };

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  detail?: Record<string, string | number | boolean>;
};

export async function audit(db: Db, e: AuditEntry, now = Date.now()): Promise<void> {
  await db
    .prepare(Q.INSERT_AUDIT)
    .bind(randomId(), e.actorId, e.action, e.entity ?? null, e.entityId ?? null, JSON.stringify(e.detail ?? {}), now)
    .run();
}

/**
 * Check the password and start a session.
 * The attempt is counted first, in one atomic write, so parallel requests
 * cannot slip past the limit. A correct password clears the counter.
 */
export async function signIn(
  db: Db,
  input: { password: unknown; adminPass: string | undefined; clientKey: string },
  now = Date.now(),
): Promise<SignInResult> {
  const pass = input.adminPass ?? "";
  if (pass.length < AUTH.minPasswordLength) return { ok: false, reason: "unavailable" };

  const key = await limitKey("login", input.clientKey);
  const attempts = await hit(db, key, AUTH.windowMinutes * 60_000, now);
  if (attempts > AUTH.maxAttempts) {
    // Logged once per lockout, so an attacker cannot flood the audit log.
    if (attempts === AUTH.maxAttempts + 1) await audit(db, { actorId: null, action: "admin.login_locked" }, now);
    return { ok: false, reason: "locked" };
  }

  const typed = typeof input.password === "string" ? input.password : "";
  const valid =
    typed.length > 0 && typed.length <= AUTH.maxPasswordLength && (await secretEquals(typed, pass));
  if (!valid) {
    await audit(db, { actorId: null, action: "admin.login_failed" }, now);
    return { ok: false, reason: "bad" };
  }

  const token = randomToken();
  const expiresAt = now + AUTH.sessionHours * 3_600_000;
  await clear(db, key);
  await db.prepare(Q.DELETE_EXPIRED_SESSIONS).bind(now).run();
  await db.prepare(Q.INSERT_SESSION).bind(await sha256Hex(token), AUTH.platformAdminId, now, expiresAt).run();
  await audit(db, { actorId: AUTH.platformAdminId, action: "admin.login" }, now);
  return { ok: true, token, expiresAt };
}

/** The signed-in admin for a cookie token, or null. */
export async function findSession(
  db: Db,
  token: string | undefined,
  now = Date.now(),
): Promise<{ actorId: string } | null> {
  if (!token || token.length > 100 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const row = await db
    .prepare(Q.FIND_SESSION)
    .bind(await sha256Hex(token), now)
    .first<{ actor_id: string }>();
  return row ? { actorId: row.actor_id } : null;
}

export async function signOut(db: Db, token: string | undefined, now = Date.now()): Promise<void> {
  const s = await findSession(db, token, now);
  if (!s || !token) return;
  await db.prepare(Q.DELETE_SESSION).bind(await sha256Hex(token)).run();
  await audit(db, { actorId: s.actorId, action: "admin.logout" }, now);
}

export async function recentAudit(db: Db, limit = 20) {
  const { results } = await db
    .prepare(Q.RECENT_AUDIT)
    .bind(Math.min(Math.max(limit, 1), 100))
    .all<{ actor_id: string | null; action: string; entity: string | null; entity_id: string | null; at: number }>();
  return results;
}
