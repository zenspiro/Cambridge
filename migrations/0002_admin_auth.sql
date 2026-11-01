-- Admin sign-in (Step 1-lite): one platform admin, password from the ADMIN_PASS secret.
-- actor_id is 'platform-admin' for now; personal admin accounts can replace it later.

-- Sessions: only the SHA-256 of the cookie token is stored.
CREATE TABLE admin_session (
  token_hash   TEXT PRIMARY KEY,
  actor_id     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX admin_session_expires ON admin_session (expires_at);

-- Sign-in attempts per network (SHA-256 of the IP, never the IP itself).
-- Counted before the password is checked, in one atomic write, so a burst of
-- parallel requests cannot get past the limit.
CREATE TABLE login_attempt (
  key           TEXT PRIMARY KEY,
  attempts      INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

-- Audit log (brief 3.2, 10). Kept on purpose when accounts go: no cascade.
-- detail is a small JSON object and never holds passwords, tokens or typed text.
CREATE TABLE audit_log (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail)),
  at         INTEGER NOT NULL
);
CREATE INDEX audit_log_at ON audit_log (at);
CREATE INDEX audit_log_entity ON audit_log (entity, entity_id);
