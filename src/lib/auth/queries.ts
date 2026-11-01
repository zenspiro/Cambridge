// Every SQL statement for admin sign-in, in one place (brief 15.3). Bound parameters only.

export const INSERT_SESSION = `
INSERT INTO admin_session (token_hash, actor_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`;

export const FIND_SESSION = `
SELECT actor_id, expires_at FROM admin_session WHERE token_hash = ?1 AND expires_at > ?2`;

export const DELETE_SESSION = `DELETE FROM admin_session WHERE token_hash = ?1`;

/** Housekeeping on each sign-in, capped so it never runs unbounded. */
export const DELETE_EXPIRED_SESSIONS = `
DELETE FROM admin_session WHERE token_hash IN (
  SELECT token_hash FROM admin_session WHERE expires_at <= ?1 LIMIT 500)`;

export const INSERT_AUDIT = `
INSERT INTO audit_log (id, actor_id, action, entity, entity_id, detail, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`;

export const RECENT_AUDIT = `
SELECT actor_id, action, entity, entity_id, at FROM audit_log ORDER BY at DESC LIMIT ?1`;
