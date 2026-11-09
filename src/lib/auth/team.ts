// Team access (owner, 9 Nov 2026): people the owner invites to help, with access per area and per subject. Areas:
// the library (papers and files, uploads), source review (the review screen for papers the AI read), AI review
// (AI-written questions, once built). Each is none, view or edit. Everything else (setup, money, users, starting paid
// AI runs, the agent, sources) stays with the owner. Takes the database as a parameter (unit tested). No Next imports.
import type { Db } from "../db.ts";
import { TEAM } from "../config.ts";
import { randomId, randomToken, sha256Hex } from "./crypto.ts";
import { audit } from "./session.ts";

export type Level = "none" | "view" | "edit";
export type Area = "library" | "sourceReview" | "aiReview";
export type Access = { library: Level; sourceReview: Level; aiReview: Level; subjects: "all" | string[] };

export const AREAS: readonly Area[] = ["library", "sourceReview", "aiReview"];
export const AREA_WORDS: Record<Area, { name: string; what: string }> = {
  library: { name: "Library", what: "papers and files: view them, or also upload and add files" },
  sourceReview: { name: "Source review", what: "the review screen for papers the AI read: view, or also fix flags" },
  aiReview: { name: "AI review", what: "questions the AI writes: view, or also fix them (when question writing is built)" },
};
export const LEVEL_WORDS: Record<Level, string> = { none: "No access", view: "View only", edit: "View and edit" };

/** Everything, for the owner. */
export const OWNER_ACCESS: Access = { library: "edit", sourceReview: "edit", aiReview: "edit", subjects: "all" };
export const NO_ACCESS: Access = { library: "none", sourceReview: "none", aiReview: "none", subjects: [] };

const LEVELS: readonly Level[] = ["none", "view", "edit"];
const CODE_RE = /^[0-9]{4}$/;
const rank = (l: Level) => LEVELS.indexOf(l);

/** Stored or posted access made safe: unknown levels are none, subjects are known codes (or "all"). Pure. */
export function cleanAccess(v: unknown, known: ReadonlySet<string> | null = null): Access {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const level = (x: unknown): Level => (LEVELS.includes(x as Level) ? (x as Level) : "none");
  const subjects = o.subjects === "all"
    ? "all"
    : Array.isArray(o.subjects)
      ? [...new Set(o.subjects.filter((c): c is string => typeof c === "string" && CODE_RE.test(c) && (!known || known.has(c))))].slice(0, TEAM.maxSubjects).sort()
      : [];
  return { library: level(o.library), sourceReview: level(o.sourceReview), aiReview: level(o.aiReview), subjects };
}

/** Access from the invite or edit form: `library`, `sourceReview`, `aiReview` levels, `subject` codes or `all`. Pure. */
export function accessFromForm(form: { get(k: string): unknown; getAll(k: string): unknown[] }, known: ReadonlySet<string>): Access {
  const subjects = form.get("allSubjects") === "1" ? "all" : form.getAll("subject").map(String);
  return cleanAccess({ library: form.get("library"), sourceReview: form.get("sourceReview"), aiReview: form.get("aiReview"), subjects }, known);
}

/** Whether access reaches `area` at `level`, for subject `code` when given (none given: any of its subjects). Pure. */
export function can(a: Access, area: Area, level: Exclude<Level, "none">, code?: string | null): boolean {
  if (rank(a[area]) < rank(level)) return false;
  if (code === undefined || code === null) return a.subjects === "all" || a.subjects.length > 0;
  return a.subjects === "all" || a.subjects.includes(code);
}

/** Whether a subject is in the access at all (any area). Pure. */
export const hasSubject = (a: Access, code: string) => a.subjects === "all" || a.subjects.includes(code);

/** Access in words for a list: "Library: view only; Source review: view and edit; 0625, 0620". Pure. */
export function accessWords(a: Access): string {
  const areas = AREAS.filter((x) => a[x] !== "none").map((x) => `${AREA_WORDS[x].name}: ${LEVEL_WORDS[a[x]].toLowerCase()}`);
  const subjects = a.subjects === "all" ? "every subject" : a.subjects.length ? a.subjects.join(", ") : "no subjects";
  return `${areas.length ? areas.join("; ") : "No access"}; ${subjects}`;
}

const parse = (s: string | null | undefined): unknown => {
  try {
    return JSON.parse(s ?? "null");
  } catch {
    return null;
  }
};

export type Member = { userId: string; name: string; email: string; access: Access; status: "active" | "paused"; createdAt: number };

/** One team member, if the account is one (any status). */
export async function readMember(db: Db, userId: string): Promise<Member | null> {
  const r = await db
    .prepare(`SELECT m.user_id, m.access, m.status, m.created_at, u.name, u.email, u."firstName" AS first, u."lastName" AS last
              FROM team_member m JOIN "auth_user" u ON u.id = m.user_id WHERE m.user_id = ?1`)
    .bind(userId)
    .first<{ user_id: string; access: string; status: "active" | "paused"; created_at: number; name: string; email: string; first: string | null; last: string | null }>();
  return r ? { userId: r.user_id, name: [r.first, r.last].filter(Boolean).join(" ") || r.name, email: r.email, access: cleanAccess(parse(r.access)), status: r.status, createdAt: r.created_at } : null;
}

export async function listMembers(db: Db): Promise<Member[]> {
  const { results } = await db
    .prepare(`SELECT m.user_id, m.access, m.status, m.created_at, u.name, u.email, u."firstName" AS first, u."lastName" AS last
              FROM team_member m JOIN "auth_user" u ON u.id = m.user_id ORDER BY m.created_at`)
    .bind()
    .all<{ user_id: string; access: string; status: "active" | "paused"; created_at: number; name: string; email: string; first: string | null; last: string | null }>();
  return results.map((r) => ({ userId: r.user_id, name: [r.first, r.last].filter(Boolean).join(" ") || r.name, email: r.email, access: cleanAccess(parse(r.access)), status: r.status, createdAt: r.created_at }));
}

export type Invite = { id: string; email: string; name: string; access: Access; status: string; createdAt: number; expiresAt: number };

/** Pending invites, newest first (expired ones say so on the page). */
export async function listInvites(db: Db): Promise<Invite[]> {
  const { results } = await db
    .prepare(`SELECT id, email, name, access, status, created_at, expires_at FROM team_invite WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100`)
    .bind()
    .all<{ id: string; email: string; name: string; access: string; status: string; created_at: number; expires_at: number }>();
  return results.map((r) => ({ id: r.id, email: r.email, name: r.name, access: cleanAccess(parse(r.access)), status: r.status, createdAt: r.created_at, expiresAt: r.expires_at }));
}

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i;
export const cleanInviteEmail = (v: unknown) => (typeof v === "string" && EMAIL_RE.test(v.trim()) ? v.trim().toLowerCase() : null);
export const cleanInviteName = (v: unknown) => (typeof v === "string" ? v.replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 80) : "");

export type InviteResult = { ok: true; token: string; id: string } | { ok: false; reason: "bad_email" | "no_name" | "no_access" | "member" | "busy" };

/** A new invite (an older pending one to the same email is replaced). Returns the token for the email only. */
export async function createInvite(db: Db, emailIn: unknown, nameIn: unknown, access: Access, actorId: string, now = Date.now()): Promise<InviteResult> {
  const email = cleanInviteEmail(emailIn);
  const name = cleanInviteName(nameIn);
  if (!email) return { ok: false, reason: "bad_email" };
  if (!name) return { ok: false, reason: "no_name" };
  if (!AREAS.some((a) => access[a] !== "none") || (access.subjects !== "all" && !access.subjects.length)) return { ok: false, reason: "no_access" };
  const existing = await db.prepare(`SELECT 1 AS x FROM team_member m JOIN "auth_user" u ON u.id = m.user_id WHERE lower(u.email) = ?1`).bind(email).first();
  if (existing) return { ok: false, reason: "member" };
  const today = await db.prepare(`SELECT COUNT(*) AS n FROM team_invite WHERE created_at >= ?1`).bind(now - 86_400_000).first<{ n: number }>();
  if ((today?.n ?? 0) >= TEAM.invitesPerDay) return { ok: false, reason: "busy" };
  await db.prepare(`UPDATE team_invite SET status = 'replaced' WHERE email = ?1 AND status = 'pending'`).bind(email).run();
  const token = randomToken();
  const id = randomId();
  await db
    .prepare(`INSERT INTO team_invite (id, email, name, access, token_hash, status, invited_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8)`)
    .bind(id, email, name, JSON.stringify(access), await sha256Hex(token), actorId, now, now + TEAM.inviteDays * 86_400_000)
    .run();
  await audit(db, { actorId, action: "team.invite", entity: "team_invite", entityId: id, detail: { access: accessWords(access) } }, now);
  return { ok: true, token, id };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{20,100}$/;

export type OpenInvite = { ok: true; id: string; email: string; name: string; access: Access } | { ok: false; reason: "unknown" | "used" | "expired" };

/** An invite by its link: pending and in date, or why not. */
export async function openInvite(db: Db, token: string, now = Date.now()): Promise<OpenInvite> {
  if (!TOKEN_RE.test(token)) return { ok: false, reason: "unknown" };
  const r = await db
    .prepare(`SELECT id, email, name, access, status, expires_at FROM team_invite WHERE token_hash = ?1`)
    .bind(await sha256Hex(token))
    .first<{ id: string; email: string; name: string; access: string; status: string; expires_at: number }>();
  if (!r) return { ok: false, reason: "unknown" };
  if (r.status !== "pending") return { ok: false, reason: r.status === "accepted" ? "used" : "unknown" };
  if (r.expires_at < now) return { ok: false, reason: "expired" };
  return { ok: true, id: r.id, email: r.email, name: r.name, access: cleanAccess(parse(r.access)) };
}

export type AcceptResult = "ok" | "unknown" | "used" | "expired" | "wrong_email";

/** The signed-in person takes the invite: only with the invited, verified email; once (checked inside the update). */
export async function acceptInvite(db: Db, token: string, user: { id: string; email: string }, now = Date.now()): Promise<AcceptResult> {
  const inv = await openInvite(db, token, now);
  if (!inv.ok) return inv.reason;
  if (inv.email !== user.email.trim().toLowerCase()) return "wrong_email";
  const taken = await db
    .prepare(`UPDATE team_invite SET status = 'accepted', accepted_by = ?2, accepted_at = ?3 WHERE id = ?1 AND status = 'pending' AND expires_at >= ?3 RETURNING id`)
    .bind(inv.id, user.id, now)
    .first();
  if (!taken) return "used";
  await db
    .prepare(`INSERT INTO team_member (user_id, access, status, invited_by, created_at, updated_at) VALUES (?1, ?2, 'active', 'platform-admin', ?3, ?3)
              ON CONFLICT (user_id) DO UPDATE SET access = ?2, status = 'active', updated_at = ?3`)
    .bind(user.id, JSON.stringify(inv.access), now)
    .run();
  await audit(db, { actorId: `team:${user.id}`, action: "team.join", entity: "team_member", entityId: user.id }, now);
  return "ok";
}

export async function cancelInvite(db: Db, id: string, actorId: string, now = Date.now()): Promise<boolean> {
  const r = await db.prepare(`UPDATE team_invite SET status = 'cancelled' WHERE id = ?1 AND status = 'pending' RETURNING id`).bind(id).first();
  if (r) await audit(db, { actorId, action: "team.invite_cancel", entity: "team_invite", entityId: id }, now);
  return !!r;
}

/** Change a member's access, pause or resume them, or remove them from the team (their account stays). */
export async function updateMember(db: Db, userId: string, change: { access?: Access; status?: "active" | "paused"; remove?: boolean }, actorId: string, now = Date.now()): Promise<boolean> {
  if (change.remove) {
    const r = await db.prepare(`DELETE FROM team_member WHERE user_id = ?1 RETURNING user_id`).bind(userId).first();
    if (r) await audit(db, { actorId, action: "team.remove", entity: "team_member", entityId: userId }, now);
    return !!r;
  }
  const sets: string[] = [];
  const values: unknown[] = [userId, now];
  if (change.access) {
    values.push(JSON.stringify(change.access));
    sets.push(`access = ?${values.length}`);
  }
  if (change.status) {
    values.push(change.status);
    sets.push(`status = ?${values.length}`);
  }
  if (!sets.length) return false;
  const r = await db.prepare(`UPDATE team_member SET ${sets.join(", ")}, updated_at = ?2 WHERE user_id = ?1 RETURNING user_id`).bind(...values).first();
  if (r) await audit(db, { actorId, action: change.access ? "team.access" : change.status === "paused" ? "team.pause" : "team.resume", entity: "team_member", entityId: userId, detail: change.access ? { access: accessWords(change.access) } : {} }, now);
  return !!r;
}
