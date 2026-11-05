-- Student and parent accounts (Phase 1 step 2, owner approved Better Auth, 5 Nov 2026).
-- The four auth_* tables are Better Auth's own shape (camelCase columns, dates as Better Auth writes them),
-- generated from better-auth 1.7.12 for SQLite. Our conventions apply to our own tables (user_role).
-- Deleting an auth_user removes its sessions, sign-in methods and roles (cascade).

CREATE TABLE "auth_user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null,
  "firstName" text,
  "lastName" text
);

CREATE TABLE "auth_session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "auth_user" ("id") on delete cascade
);

CREATE TABLE "auth_account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "auth_user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

CREATE TABLE "auth_verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

CREATE INDEX "auth_session_userId_idx" ON "auth_session" ("userId");
CREATE INDEX "auth_account_userId_idx" ON "auth_account" ("userId");
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");

-- Roles held per person (one person may be a student and a parent, later a teacher).
CREATE TABLE user_role (
  user_id    TEXT NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('student', 'parent', 'teacher')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, role)
);
