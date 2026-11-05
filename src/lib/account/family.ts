// Families (Phase 1 step 4). Owner decisions (5 Nov 2026): one parent per family, no second guardian, a child in
// one family; children join with a family code, are linked when that parent approved them, or get an account made
// by the parent (their own email, counted as approved); a child may leave only once over the age limit.
// No Next imports (unit tested).
import type { Db } from "../db.ts";
import { audit } from "../auth/session.ts";
import { randomId } from "../auth/crypto.ts";
import { FAMILY } from "../config.ts";
import { ageLimit, getConsentSettings, getProfile, listExamPlans, markApproved, mayBeUnder, saveDetails, standing, type ExamPlan, type Standing } from "./profile.ts";
import { getRoles } from "./roles.ts";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function newCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(FAMILY.codeLength));
  return [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

/** A family code as typed: spaces and dashes ignored, upper case. */
export function cleanFamilyCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\s-]+/g, "").toUpperCase();
  return new RegExp(`^[${CODE_ALPHABET}]{${FAMILY.codeLength}}$`).test(s) ? s : null;
}

/** "ABCD-EFGH": easier to read out. */
export const showCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

export async function familyOf(db: Db, parentId: string): Promise<string | null> {
  return (await db.prepare(`SELECT id FROM family WHERE parent_id = ?1`).bind(parentId).first<{ id: string }>())?.id ?? null;
}

async function ensureFamily(db: Db, parentId: string, now: number): Promise<string> {
  await db.prepare(`INSERT OR IGNORE INTO family (id, parent_id, created_at) VALUES (?1, ?2, ?3)`).bind(randomId(), parentId, now).run();
  return (await familyOf(db, parentId)) as string;
}

const childCount = async (db: Db, familyId: string) =>
  (await db.prepare(`SELECT count(*) AS n FROM family_child WHERE family_id = ?1`).bind(familyId).first<{ n: number }>())?.n ?? 0;

/** Adds a child to the parent's family unless they are already in one or the family is full. */
async function addChild(db: Db, parentId: string, childId: string, how: "code" | "approved" | "created", now: number): Promise<"ok" | "in_family" | "full"> {
  if (childId === parentId) return "in_family";
  const familyId = await ensureFamily(db, parentId, now);
  if ((await childCount(db, familyId)) >= FAMILY.maxChildren) return "full";
  const r = await db
    .prepare(`INSERT OR IGNORE INTO family_child (family_id, child_id, how, joined_at) VALUES (?1, ?2, ?3, ?4) RETURNING child_id`)
    .bind(familyId, childId, how, now)
    .first<{ child_id: string }>();
  if (!r) return "in_family";
  await audit(db, { actorId: parentId, action: "family.add", entity: "account", entityId: childId, detail: { how } }, now);
  return "ok";
}

// ---------- Family code ----------

export type FamilyCode = { code: string; expiresAt: number };

/** The parent's live code, if any. */
export async function liveCode(db: Db, parentId: string, now = Date.now()): Promise<FamilyCode | null> {
  const r = await db
    .prepare(`SELECT c.code, c.expires_at FROM family_code c JOIN family f ON f.id = c.family_id WHERE f.parent_id = ?1 AND c.expires_at > ?2`)
    .bind(parentId, now)
    .first<{ code: string; expires_at: number }>();
  return r ? { code: r.code, expiresAt: r.expires_at } : null;
}

/** A new code for the parent's family (the old one stops working). */
export async function makeCode(db: Db, parentId: string, now = Date.now()): Promise<FamilyCode> {
  const familyId = await ensureFamily(db, parentId, now);
  const code = newCode();
  const expiresAt = now + FAMILY.codeDays * 86_400_000;
  await db
    .prepare(
      `INSERT INTO family_code (family_id, code, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (family_id) DO UPDATE SET code = ?2, created_at = ?3, expires_at = ?4`,
    )
    .bind(familyId, code, now, expiresAt)
    .run();
  await audit(db, { actorId: parentId, action: "family.code", entity: "family", entityId: familyId }, now);
  return { code, expiresAt };
}

export type JoinResult = "ok_joined" | "bad_code" | "in_family" | "full" | "not_student";

/** A signed-in student joins the family whose live code they typed. */
export async function joinByCode(db: Db, childId: string, typed: unknown, now = Date.now()): Promise<JoinResult> {
  if (!(await getRoles(db, childId)).includes("student")) return "not_student";
  const code = cleanFamilyCode(typed);
  if (!code) return "bad_code";
  const f = await db
    .prepare(`SELECT f.parent_id FROM family_code c JOIN family f ON f.id = c.family_id WHERE c.code = ?1 AND c.expires_at > ?2`)
    .bind(code, now)
    .first<{ parent_id: string }>();
  if (!f) return "bad_code";
  const r = await addChild(db, f.parent_id, childId, "code", now);
  return r === "ok" ? "ok_joined" : r;
}

// ---------- Linked by approval, approve from home ----------

/**
 * Children this parent approved by email (same address) join the family by themselves, once per approval: each
 * approval is marked linked, so a child the parent later removes is not added back. Returns how many joined.
 */
export async function linkApproved(db: Db, parentId: string, parentEmail: string, now = Date.now()): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT id, child_id FROM parent_consent
       WHERE status = 'approved' AND linked_at IS NULL AND parent_email = ?1 AND child_id <> ?2`,
    )
    .bind(parentEmail.toLowerCase(), parentId)
    .all<{ id: string; child_id: string }>();
  let n = 0;
  for (const r of results) {
    if ((await addChild(db, parentId, r.child_id, "approved", now)) === "ok") n++;
    await db.prepare(`UPDATE parent_consent SET linked_at = ?2 WHERE id = ?1`).bind(r.id, now).run();
  }
  return n;
}

export type Waiting = { id: string; firstName: string; lastName: string; expiresAt: number };

/** Approval requests addressed to this parent's email that are still open. */
export async function waitingForParent(db: Db, parentEmail: string, now = Date.now()): Promise<Waiting[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.expires_at, u."firstName" AS first_name, u."lastName" AS last_name
       FROM parent_consent c JOIN "auth_user" u ON u.id = c.child_id
       WHERE c.status = 'pending' AND c.expires_at > ?2 AND c.parent_email = ?1 ORDER BY c.created_at`,
    )
    .bind(parentEmail.toLowerCase(), now)
    .all<{ id: string; expires_at: number; first_name: string | null; last_name: string | null }>();
  return results.map((r) => ({ id: r.id, firstName: r.first_name ?? "", lastName: r.last_name ?? "", expiresAt: r.expires_at }));
}

// ---------- Child accounts made by the parent ----------

export type NewChild = { firstName: string; lastName: string; email: string; birthYear: number; country: string };
export type CreateResult = "ok_created" | "has_account" | "full";

/**
 * The parent makes a student account with the child's own email. It counts as approved (the parent made it); the
 * child signs in with a code sent to that email. An email that already has an account is refused (that child
 * joins with the family code instead), so nobody can take over someone else's account this way.
 */
export async function createChild(db: Db, parentId: string, c: NewChild, now = Date.now()): Promise<CreateResult> {
  const exists = await db.prepare(`SELECT 1 AS x FROM "auth_user" WHERE email = ?1`).bind(c.email).first();
  if (exists) return "has_account";
  const familyId = await ensureFamily(db, parentId, now);
  if ((await childCount(db, familyId)) >= FAMILY.maxChildren) return "full";
  const id = randomId();
  const iso = new Date(now).toISOString();
  await db
    .prepare(
      `INSERT INTO "auth_user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "firstName", "lastName")
       VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5, ?6)`,
    )
    .bind(id, `${c.firstName} ${c.lastName}`, c.email, iso, c.firstName, c.lastName)
    .run();
  await db.prepare(`INSERT INTO user_role (user_id, role, created_at) VALUES (?1, 'student', ?2)`).bind(id, now).run();
  await saveDetails(db, id, { country: c.country, birthYear: c.birthYear }, now);
  await markApproved(db, id, now);
  await audit(db, { actorId: parentId, action: "account.created_by_parent", entity: "account", entityId: id }, now);
  await addChild(db, parentId, id, "created", now);
  return "ok_created";
}

// ---------- The family as each side sees it ----------

export type Child = { id: string; firstName: string; lastName: string; email: string; how: string; joinedAt: number; standing: Standing; exams: ExamPlan[] };

export async function listChildren(db: Db, parentId: string): Promise<Child[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u."firstName" AS first_name, u."lastName" AS last_name, u.email, m.how, m.joined_at
       FROM family f JOIN family_child m ON m.family_id = f.id JOIN "auth_user" u ON u.id = m.child_id
       WHERE f.parent_id = ?1 ORDER BY m.joined_at`,
    )
    .bind(parentId)
    .all<{ id: string; first_name: string | null; last_name: string | null; email: string; how: string; joined_at: number }>();
  const out: Child[] = [];
  for (const r of results) {
    out.push({
      id: r.id,
      firstName: r.first_name ?? "",
      lastName: r.last_name ?? "",
      email: r.email,
      how: r.how,
      joinedAt: r.joined_at,
      standing: await standing(db, r.id, ["student"]),
      exams: await listExamPlans(db, r.id),
    });
  }
  return out;
}

/** True when this child is in this parent's family (checked before any parent action on a child). */
export async function isMyChild(db: Db, parentId: string, childId: string): Promise<boolean> {
  return Boolean(
    await db.prepare(`SELECT 1 AS x FROM family f JOIN family_child m ON m.family_id = f.id WHERE f.parent_id = ?1 AND m.child_id = ?2`).bind(parentId, childId).first(),
  );
}

export async function removeChild(db: Db, parentId: string, childId: string, now = Date.now()): Promise<boolean> {
  if (!(await isMyChild(db, parentId, childId))) return false;
  await db.prepare(`DELETE FROM family_child WHERE child_id = ?1`).bind(childId).run();
  await audit(db, { actorId: parentId, action: "family.remove", entity: "account", entityId: childId }, now);
  return true;
}

export type MyFamily = { parentFirstName: string; parentLastName: string; canLeave: boolean };

/** The student's side: whose family they are in, and whether they may leave (only once over the age limit). */
export async function myFamily(db: Db, childId: string, year = new Date().getUTCFullYear()): Promise<MyFamily | null> {
  const r = await db
    .prepare(
      `SELECT u."firstName" AS first_name, u."lastName" AS last_name FROM family_child m
       JOIN family f ON f.id = m.family_id JOIN "auth_user" u ON u.id = f.parent_id WHERE m.child_id = ?1`,
    )
    .bind(childId)
    .first<{ first_name: string | null; last_name: string | null }>();
  if (!r) return null;
  const p = await getProfile(db, childId);
  const limit = ageLimit(await getConsentSettings(db), p.country);
  const canLeave = p.birthYear !== null && !mayBeUnder(p.birthYear, limit, year);
  return { parentFirstName: r.first_name ?? "", parentLastName: r.last_name ?? "", canLeave };
}

export async function leaveFamily(db: Db, childId: string, now = Date.now()): Promise<"ok_left" | "too_young" | "no_family"> {
  const f = await myFamily(db, childId);
  if (!f) return "no_family";
  if (!f.canLeave) return "too_young";
  await db.prepare(`DELETE FROM family_child WHERE child_id = ?1`).bind(childId).run();
  await audit(db, { actorId: childId, action: "family.leave", entity: "account", entityId: childId }, now);
  return "ok_left";
}
