// Profiles, parent approval, exam plans, export and delete for student and parent accounts (Phase 1 step 3).
// Owner decisions (5 Nov 2026): a parent approves every student under the age limit (a setting per country);
// one-tap approval without a parent account; a decline deletes the student's account. No Next imports (unit tested).
import type { Db } from "../db.ts";
import { audit } from "../auth/session.ts";
import { randomId, randomToken, sha256Hex } from "../auth/crypto.ts";
import { CONSENT, THEMES, type AccountRole, type ThemeId } from "../config.ts";
import { isCountry } from "../countries.ts";

// ---------- Age limits (setting 'consent') ----------

export type ConsentSettings = { defaultAge: number; byCountry: Record<string, number> };
export const CONSENT_DEFAULTS: ConsentSettings = { defaultAge: CONSENT.defaultAge, byCountry: {} };

const ageOk = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= CONSENT.minAge && n <= CONSENT.maxAge;

export function checkConsentSettings(v: unknown): ConsentSettings | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!ageOk(o.defaultAge)) return null;
  const by = o.byCountry && typeof o.byCountry === "object" ? (o.byCountry as Record<string, unknown>) : {};
  const byCountry: Record<string, number> = {};
  for (const [c, n] of Object.entries(by)) {
    if (!isCountry(c) || !ageOk(n)) return null;
    byCountry[c] = n;
  }
  return { defaultAge: o.defaultAge, byCountry };
}

export async function getConsentSettings(db: Db): Promise<ConsentSettings> {
  const row = await db.prepare(`SELECT value FROM setting WHERE key = 'consent'`).bind().first<{ value: string }>();
  try {
    return checkConsentSettings(row ? JSON.parse(row.value) : null) ?? CONSENT_DEFAULTS;
  } catch {
    return CONSENT_DEFAULTS;
  }
}

export async function saveConsentSettings(db: Db, v: ConsentSettings, actorId: string, now = Date.now()) {
  await db
    .prepare(
      `INSERT INTO setting (key, value, updated_by, updated_at) VALUES ('consent', ?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = ?3`,
    )
    .bind(JSON.stringify(v), actorId, now)
    .run();
  await audit(db, { actorId, action: "setting.consent", entity: "setting", entityId: "consent" }, now);
}

export const ageLimit = (s: ConsentSettings, country: string | null) => (country && s.byCountry[country]) || s.defaultAge;

/**
 * True when someone born in `birthYear` could still be under `limit` this year. Only the year is known, so the
 * safe side: born 2008 is asked in 2026 even if they turned 18 in January.
 */
export const mayBeUnder = (birthYear: number, limit: number, year: number) => year - birthYear <= limit;

export const birthYears = (year: number) => Array.from({ length: CONSENT.oldestAge - CONSENT.youngestAge + 1 }, (_, i) => year - CONSENT.youngestAge - i);
export const birthYearOk = (y: unknown, year: number): y is number =>
  typeof y === "number" && Number.isInteger(y) && y <= year - CONSENT.youngestAge && y >= year - CONSENT.oldestAge;

// ---------- Profile ----------

export type Profile = {
  birthYear: number | null;
  country: string | null;
  theme: ThemeId | null;
  approvedAt: number | null;
  examSkippedAt: number | null;
};

const EMPTY: Profile = { birthYear: null, country: null, theme: null, approvedAt: null, examSkippedAt: null };

export async function getProfile(db: Db, userId: string): Promise<Profile> {
  const r = await db
    .prepare(`SELECT birth_year, country, theme, approved_at, exam_skipped_at FROM profile WHERE user_id = ?1`)
    .bind(userId)
    .first<{ birth_year: number | null; country: string | null; theme: string | null; approved_at: number | null; exam_skipped_at: number | null }>();
  if (!r) return EMPTY;
  return {
    birthYear: r.birth_year,
    country: r.country,
    theme: THEMES.find((t) => t.id === r.theme)?.id ?? null,
    approvedAt: r.approved_at,
    examSkippedAt: r.exam_skipped_at,
  };
}

/** Creates the row when missing, then sets the given columns (only names from this fixed list are ever used). */
async function setProfile(db: Db, userId: string, fields: Partial<Record<"birth_year" | "country" | "theme" | "approved_at" | "exam_skipped_at", string | number | null>>, now: number) {
  await db.prepare(`INSERT OR IGNORE INTO profile (user_id, updated_at) VALUES (?1, ?2)`).bind(userId, now).run();
  const cols = Object.keys(fields) as (keyof typeof fields)[];
  if (!cols.length) return;
  const set = cols.map((c, i) => `${c} = ?${i + 3}`).join(", ");
  await db.prepare(`UPDATE profile SET updated_at = ?2, ${set} WHERE user_id = ?1`).bind(userId, now, ...cols.map((c) => fields[c] ?? null)).run();
}

export type Details = { country: string; birthYear: number | null };

/** Country for everyone; birth year for students (refused once a parent approved, so it cannot be edited away). */
export function checkDetails(v: { country: unknown; birthYear: unknown }, isStudent: boolean, year: number): Details | null {
  if (!isCountry(v.country)) return null;
  if (!isStudent) return { country: v.country, birthYear: null };
  const by = typeof v.birthYear === "string" ? Number(v.birthYear) : v.birthYear;
  return birthYearOk(by, year) ? { country: v.country, birthYear: by } : null;
}

export async function saveDetails(db: Db, userId: string, d: Details, now = Date.now()) {
  const p = await getProfile(db, userId);
  const fields: Parameters<typeof setProfile>[2] = { country: d.country };
  if (d.birthYear !== null && !p.approvedAt) fields.birth_year = d.birthYear;
  await setProfile(db, userId, fields, now);
}

export async function saveTheme(db: Db, userId: string, theme: ThemeId, now = Date.now()) {
  await setProfile(db, userId, { theme }, now);
}

export async function skipExamPrompt(db: Db, userId: string, now = Date.now()) {
  await setProfile(db, userId, { exam_skipped_at: now }, now);
}

/**
 * Where a student stands: "details" (birth year or country still missing), "pending" (a parent must approve),
 * or "ok". Parents and others are always "ok".
 */
export type Standing = "ok" | "details" | "pending";

export async function standing(db: Db, userId: string, roles: readonly AccountRole[], year = new Date().getUTCFullYear()): Promise<Standing> {
  if (!roles.includes("student")) return "ok";
  const p = await getProfile(db, userId);
  if (p.birthYear === null || p.country === null) return "details";
  if (p.approvedAt) return "ok";
  return mayBeUnder(p.birthYear, ageLimit(await getConsentSettings(db), p.country), year) ? "pending" : "ok";
}

// ---------- Exam plans ----------

export type ExamPlan = { code: string; session: "m" | "s" | "w"; year: number };

export async function listExamPlans(db: Db, userId: string): Promise<ExamPlan[]> {
  const { results } = await db
    .prepare(`SELECT syllabus_code, session, year FROM exam_plan WHERE user_id = ?1 ORDER BY year, CASE session WHEN 'm' THEN 1 WHEN 's' THEN 2 ELSE 3 END, syllabus_code`)
    .bind(userId)
    .all<{ syllabus_code: string; session: "m" | "s" | "w"; year: number }>();
  return results.map((r) => ({ code: r.syllabus_code, session: r.session, year: r.year }));
}

export const examYears = (year: number) => Array.from({ length: CONSENT.examYearsAhead + 1 }, (_, i) => year + i);

/** A subject the library has, a session and a year from now to a few years ahead. */
export function checkExamPlan(v: { code: unknown; session: unknown; year: unknown }, codes: readonly string[], year: number): ExamPlan | null {
  const y = typeof v.year === "string" ? Number(v.year) : v.year;
  if (typeof v.code !== "string" || !codes.includes(v.code)) return null;
  if (v.session !== "m" && v.session !== "s" && v.session !== "w") return null;
  if (typeof y !== "number" || !examYears(year).includes(y)) return null;
  return { code: v.code, session: v.session, year: y };
}

export async function saveExamPlan(db: Db, userId: string, e: ExamPlan, now = Date.now()) {
  await db
    .prepare(
      `INSERT INTO exam_plan (user_id, syllabus_code, session, year, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (user_id, syllabus_code) DO UPDATE SET session = ?3, year = ?4`,
    )
    .bind(userId, e.code, e.session, e.year, now)
    .run();
}

export async function removeExamPlan(db: Db, userId: string, code: string) {
  await db.prepare(`DELETE FROM exam_plan WHERE user_id = ?1 AND syllabus_code = ?2`).bind(userId, code).run();
}

// ---------- Parent approval requests ----------

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type ConsentRequest = { id: string; parentEmail: string; status: string; createdAt: number; expiresAt: number; decidedAt: number | null };

/** A new link for this student (any earlier pending link stops working). Returns the token for the email only. */
export async function createConsent(db: Db, childId: string, parentEmail: string, now = Date.now()): Promise<string> {
  const token = randomToken();
  await db.prepare(`UPDATE parent_consent SET status = 'replaced', decided_at = ?2 WHERE child_id = ?1 AND status = 'pending'`).bind(childId, now).run();
  await db
    .prepare(`INSERT INTO parent_consent (id, child_id, parent_email, token_hash, status, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6)`)
    .bind(randomId(), childId, parentEmail, await sha256Hex(token), now, now + CONSENT.linkDays * 86_400_000)
    .run();
  await audit(db, { actorId: childId, action: "consent.sent", entity: "account", entityId: childId }, now);
  return token;
}

export async function latestConsent(db: Db, childId: string): Promise<ConsentRequest | null> {
  const r = await db
    .prepare(`SELECT id, parent_email, status, created_at, expires_at, decided_at FROM parent_consent WHERE child_id = ?1 ORDER BY created_at DESC LIMIT 1`)
    .bind(childId)
    .first<{ id: string; parent_email: string; status: string; created_at: number; expires_at: number; decided_at: number | null }>();
  return r ? { id: r.id, parentEmail: r.parent_email, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at, decidedAt: r.decided_at } : null;
}

export type ConsentLink =
  | { ok: true; id: string; childId: string; firstName: string; lastName: string; parentEmail: string }
  | { ok: false; reason: "unknown" | "expired" | "used" };

/** What a link opens: the waiting request and the student's name, or why it no longer works. */
export async function openConsent(db: Db, token: string, now = Date.now()): Promise<ConsentLink> {
  if (!TOKEN_RE.test(token)) return { ok: false, reason: "unknown" };
  const r = await db
    .prepare(
      `SELECT c.id, c.child_id, c.parent_email, c.status, c.expires_at, u."firstName" AS first_name, u."lastName" AS last_name
       FROM parent_consent c JOIN "auth_user" u ON u.id = c.child_id WHERE c.token_hash = ?1`,
    )
    .bind(await sha256Hex(token))
    .first<{ id: string; child_id: string; parent_email: string; status: string; expires_at: number; first_name: string | null; last_name: string | null }>();
  if (!r) return { ok: false, reason: "unknown" };
  if (r.status !== "pending") return { ok: false, reason: "used" };
  if (r.expires_at <= now) return { ok: false, reason: "expired" };
  return { ok: true, id: r.id, childId: r.child_id, firstName: r.first_name ?? "", lastName: r.last_name ?? "", parentEmail: r.parent_email };
}

/**
 * The parent's answer. Approve: the student is let in (profile.approved_at). Decline: the student's account and all
 * its data are deleted (owner decision). Checked again inside the update, so a link is used once.
 */
export async function decideConsent(db: Db, token: string, answer: "approved" | "declined", now = Date.now()): Promise<ConsentLink & { answer?: string }> {
  const link = await openConsent(db, token, now);
  if (!link.ok) return link;
  const done = await db
    .prepare(`UPDATE parent_consent SET status = ?2, decided_at = ?3 WHERE id = ?1 AND status = 'pending' RETURNING id`)
    .bind(link.id, answer, now)
    .first<{ id: string }>();
  if (!done) return { ok: false, reason: "used" };
  await audit(db, { actorId: null, action: `consent.${answer}`, entity: "account", entityId: link.childId }, now);
  if (answer === "approved") await setProfile(db, link.childId, { approved_at: now }, now);
  else await deleteAccount(db, link.childId, null, now);
  return { ...link, answer };
}

/**
 * A signed-in parent answers from their own home instead of the email link: the request must still be pending, in
 * date, and addressed to the parent's own (verified) email. Same effects as the link.
 */
export async function decideConsentAsParent(db: Db, requestId: string, parentEmail: string, parentId: string, answer: "approved" | "declined", now = Date.now()): Promise<{ ok: true; childId: string } | { ok: false }> {
  const done = await db
    .prepare(
      `UPDATE parent_consent SET status = ?2, decided_at = ?3
       WHERE id = ?1 AND status = 'pending' AND expires_at > ?3 AND parent_email = ?4 RETURNING child_id`,
    )
    .bind(requestId, answer, now, parentEmail.toLowerCase())
    .first<{ child_id: string }>();
  if (!done) return { ok: false };
  await audit(db, { actorId: parentId, action: `consent.${answer}`, entity: "account", entityId: done.child_id }, now);
  if (answer === "approved") await setProfile(db, done.child_id, { approved_at: now }, now);
  else await deleteAccount(db, done.child_id, parentId, now);
  return { ok: true, childId: done.child_id };
}

/** Marks a student approved (a parent made their account, which is the approval). */
export async function markApproved(db: Db, userId: string, now = Date.now()) {
  await setProfile(db, userId, { approved_at: now }, now);
}

// ---------- Your data ----------

/** Everything we hold about one person, for "Download my data". Never tokens, codes or secrets. */
export async function exportAccount(db: Db, userId: string): Promise<Record<string, unknown>> {
  const u = await db
    .prepare(`SELECT id, email, "firstName" AS first_name, "lastName" AS last_name, "createdAt" AS created_at FROM "auth_user" WHERE id = ?1`)
    .bind(userId)
    .first<Record<string, unknown>>();
  const all = async (sql: string) => (await db.prepare(sql).bind(userId).all<Record<string, unknown>>()).results;
  return {
    exported_at: new Date().toISOString(),
    account: u,
    roles: await all(`SELECT role, created_at FROM user_role WHERE user_id = ?1`),
    profile: await db.prepare(`SELECT birth_year, country, theme, approved_at, exam_skipped_at, updated_at FROM profile WHERE user_id = ?1`).bind(userId).first(),
    exam_plans: await all(`SELECT syllabus_code, session, year, created_at FROM exam_plan WHERE user_id = ?1`),
    family: await all(`SELECT 'parent' AS as_role, created_at AS since FROM family WHERE parent_id = ?1 UNION ALL SELECT 'child', joined_at FROM family_child WHERE child_id = ?1`),
    parent_approval: await all(`SELECT parent_email, status, created_at, expires_at, decided_at FROM parent_consent WHERE child_id = ?1`),
    sign_in_methods: await all(`SELECT "providerId" AS provider, "createdAt" AS created_at FROM "auth_account" WHERE "userId" = ?1`),
    sessions: await all(`SELECT "createdAt" AS created_at, "expiresAt" AS expires_at, "userAgent" AS device FROM "auth_session" WHERE "userId" = ?1`),
    activity: await all(`SELECT action, at FROM audit_log WHERE actor_id = ?1 OR entity_id = ?1 ORDER BY at`),
  };
}

/**
 * Deletes the account and everything it owns (cascade: sessions, sign-in methods, roles, profile, exam plans,
 * approval requests) plus any unused sign-in code for its email. The audit log keeps a note (no cascade).
 */
export async function deleteAccount(db: Db, userId: string, actorId: string | null, now = Date.now()): Promise<void> {
  const u = await db.prepare(`SELECT email FROM "auth_user" WHERE id = ?1`).bind(userId).first<{ email: string }>();
  if (!u) return;
  await db.prepare(`DELETE FROM "auth_verification" WHERE "identifier" LIKE ?1`).bind(`%${u.email}`).run();
  await db.prepare(`DELETE FROM "auth_user" WHERE id = ?1`).bind(userId).run();
  await audit(db, { actorId, action: "account.deleted", entity: "account", entityId: userId }, now);
}
