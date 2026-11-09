// Who may use the admin (owner, 9 Nov 2026): the owner (the admin password sign-in: everything) or a team member (the
// email code sign-in, an active team_member row, signed in within TEAM.sessionMs) with their access. Pages call
// requireStaff(), form posts go through staffPost(). Pages and routes only for the owner keep requireAdmin(),
// adminSession() and adminPost().
import { redirect } from "next/navigation";
import { LIBRARY, TEAM } from "@/lib/config";
import type { Db } from "@/lib/db";
import { getEnv, type AppEnv } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { isSameOrigin, redirectTo } from "@/lib/http";
import { allow, limitKey } from "@/lib/ratelimit";
import { accountSession } from "@/lib/account/server";
import { adminSession } from "./guard.ts";
import { can, OWNER_ACCESS, readMember, type Access, type Area } from "./team.ts";

export type Staff = { actorId: string; owner: boolean; name: string; access: Access };
export type Need = { area: Area; level: "view" | "edit"; code?: string | null } | null;
/** The whole admin (owner, 9 Nov 2026): every section, view or change. */
export const ADMIN_VIEW: Need = { area: "admin", level: "view" };
export const ADMIN_EDIT: Need = { area: "admin", level: "edit" };

/** The signed-in owner or team member, or null. A paused member, or one signed in too long ago, is not one. */
export async function staffSession(): Promise<Staff | null> {
  const admin = await adminSession();
  if (admin) return { actorId: admin.actorId, owner: true, name: "Owner", access: OWNER_ACCESS };
  const acct = await accountSession();
  if (!acct) return null;
  if (Date.now() - acct.signedInAt > TEAM.sessionMs) return null;
  const m = await readMember((await getEnv()).DB, acct.userId);
  if (!m || m.status !== "active") return null;
  return { actorId: `team:${m.userId}`, owner: false, name: m.name, access: m.access };
}

/** Whether the staff member may do this (the owner may do everything). */
export const allowed = (s: Staff, need: Need) => s.owner || !need || can(s.access, need.area, need.level, need.code);

/**
 * Call first in an admin page the team may use. Signed out: to the sign-in page. Without the access: to Home, which
 * says so. `need` null: any staff member (Home).
 */
export async function requireStaff(need: Need): Promise<Staff> {
  const s = await staffSession();
  if (!s) redirect("/admin/login");
  if (!allowed(s, need)) redirect("/admin?e=no_access");
  return s;
}

/** For JSON and file handlers the team may use: the staff member when allowed, else null. */
export async function staffFor(need: Need): Promise<Staff | null> {
  const s = await staffSession();
  return s && allowed(s, need) ? s : null;
}

/**
 * Like adminPost for the team: same origin, a staff member with `need`, rate limit, the action, then a 303 back. The
 * action gets `check(need)` to test access to the subject it works out from what it acts on (never from the form alone).
 */
export async function staffPost(
  request: Request,
  back: string,
  need: Need,
  act: (ctx: { db: Db; env: AppEnv; form: FormData; actorId: string; staff: Staff; check: (n: Need) => boolean }) => Promise<string>,
): Promise<Response> {
  if (!isSameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const staff = await staffSession();
  if (!staff) return redirectTo(request, "/admin/login");
  if (!allowed(staff, need)) return redirectTo(request, `${back}?e=no_access`);
  try {
    const env = await getEnv();
    if (!(await allow(env.DB, await limitKey("admin-write", staff.actorId), LIBRARY.writesPerHour, 3_600_000))) {
      return redirectTo(request, `${back}?e=busy`);
    }
    const out = await act({ db: env.DB, env, form: await request.formData(), actorId: staff.actorId, staff, check: (n) => allowed(staff, n) });
    return redirectTo(request, out.startsWith("/") ? out : `${back}?e=${out}`);
  } catch (err) {
    const ref = reportError(`staff.post ${back}`, err);
    return redirectTo(request, `${back}?ref=${ref}`);
  }
}

/** The library subject a file code belongs to: itself, or the main code of another series (1524 is 0625). */
export async function mainCode(db: Db, code: string): Promise<string> {
  const r = await db.prepare(`SELECT main_code FROM syllabus_alias WHERE code = ?1`).bind(code).first<{ main_code: string }>();
  return r?.main_code ?? code;
}

/** The subject of a stored document, for access checks on routes that act on a document. */
export async function docSubject(db: Db, docId: string): Promise<string | null> {
  const r = await db
    .prepare(`SELECT y.code FROM source_document d JOIN syllabus y ON y.id = d.syllabus_id WHERE d.id = ?1`)
    .bind(docId)
    .first<{ code: string }>();
  return r?.code ?? null;
}

/**
 * For pages and handlers on one stored document (download, the PDF view, the review screen, its figures): the staff
 * member when they may view its subject in the library or in source review; else null.
 */
export async function staffForDoc(docId: string): Promise<{ staff: Staff; code: string } | null> {
  const s = await staffSession();
  if (!s) return null;
  const code = await docSubject((await getEnv()).DB, docId);
  if (!code) return s.owner ? { staff: s, code: "" } : null;
  return allowed(s, { area: "library", level: "view", code }) || allowed(s, { area: "sourceReview", level: "view", code }) ? { staff: s, code } : null;
}
