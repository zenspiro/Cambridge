-- Team access (owner, 9 Nov 2026): people the owner invites to help, each with access per area (library, source
-- review, AI review: none, view or edit) and per subject (a list of syllabus codes, or every subject). They sign in
-- with the email code sign-in; their account is an auth_user. The owner's own password sign-in is unchanged.
CREATE TABLE team_member (
  user_id     TEXT PRIMARY KEY REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  access      TEXT NOT NULL CHECK (json_valid(access)),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  invited_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- An invite: a one-time link (only its SHA-256 kept), for one email, with the access to give, for TEAM.inviteDays.
CREATE TABLE team_invite (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  access      TEXT NOT NULL CHECK (json_valid(access)),
  token_hash  TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled', 'replaced')),
  invited_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  accepted_by TEXT REFERENCES "auth_user" ("id") ON DELETE SET NULL,
  accepted_at INTEGER
);
CREATE INDEX team_invite_email ON team_invite (email, status);
