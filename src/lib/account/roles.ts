// Roles held per person and the welcome step (first sign-in): role plus first and last name. No Next imports.
import type { Db } from "../db.ts";
import { ACCOUNT, type AccountRole } from "../config.ts";

export async function getRoles(db: Db, userId: string): Promise<AccountRole[]> {
  const { results } = await db.prepare(`SELECT role FROM user_role WHERE user_id = ?1 ORDER BY created_at`).bind(userId).all<{ role: string }>();
  return results.map((r) => r.role).filter((r): r is AccountRole => (ACCOUNT.roles as readonly string[]).includes(r));
}

/** Where a signed-in person goes: the welcome step until they have a role, then their first role's home. */
export function homeFor(roles: readonly AccountRole[]): string {
  if (roles.includes("student")) return "/student";
  if (roles.includes("parent")) return "/parent";
  return "/welcome";
}

/** A name part: one line, letters (any language), spaces, apostrophes, dots and hyphens, 1 to 60 characters. */
function namePart(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s || s.length > ACCOUNT.maxNameLength) return null;
  return /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(s) ? s : null;
}

export type Welcome = { role: AccountRole; firstName: string; lastName: string };

export function checkWelcome(v: { role: unknown; firstName: unknown; lastName: unknown }): Welcome | null {
  const role = ACCOUNT.roles.find((r) => r === v.role);
  const firstName = namePart(v.firstName);
  const lastName = namePart(v.lastName);
  return role && firstName && lastName ? { role, firstName, lastName } : null;
}

/** Saves the welcome step: names on the account, the role added (a second role later is just another row). */
export async function saveWelcome(db: Db, userId: string, w: Welcome, now = Date.now()): Promise<void> {
  await db
    .prepare(`UPDATE "auth_user" SET "firstName" = ?1, "lastName" = ?2, "name" = ?3 WHERE "id" = ?4`)
    .bind(w.firstName, w.lastName, `${w.firstName} ${w.lastName}`, userId)
    .run();
  await db.prepare(`INSERT OR IGNORE INTO user_role (user_id, role, created_at) VALUES (?1, ?2, ?3)`).bind(userId, w.role, now).run();
}

/** A plain email address, lower case, or null. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s.length <= ACCOUNT.maxEmailLength && /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

/** A sign-in code as typed: digits only, spaces ignored, exactly the code length. */
export function cleanCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, "");
  return new RegExp(`^\\d{${ACCOUNT.codeLength}}$`).test(s) ? s : null;
}
