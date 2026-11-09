// Users > Students and parents (owner, 9 Nov 2026): every sign-in account in words, for the owner only. Read-only.
// Takes the database as a parameter (unit tested). No Next imports.
import type { Db } from "../db.ts";

export type AccountRow = {
  id: string; name: string; email: string; roles: string[]; country: string | null; birthYear: number | null;
  approved: boolean; createdAt: number; family: string | null; children: number; team: boolean;
};

/** Accounts newest first, filtered by words in the name or email and by role; at most `limit`. */
export async function listAccounts(db: Db, opts: { q?: string; role?: "student" | "parent" | "team" | null; limit?: number } = {}): Promise<{ rows: AccountRow[]; total: number }> {
  const { results } = await db
    .prepare(`SELECT u.id, u.name, u.email, u."firstName" AS first, u."lastName" AS last, u."createdAt" AS created,
                (SELECT group_concat(role) FROM user_role r WHERE r.user_id = u.id) AS roles,
                p.country, p.birth_year, p.approved_at,
                (SELECT COALESCE(pu."firstName" || ' ' || pu."lastName", pu.name) FROM family_child fc JOIN family f ON f.id = fc.family_id JOIN "auth_user" pu ON pu.id = f.parent_id WHERE fc.child_id = u.id) AS parent,
                (SELECT COUNT(*) FROM family f JOIN family_child fc ON fc.family_id = f.id WHERE f.parent_id = u.id) AS children,
                EXISTS (SELECT 1 FROM team_member m WHERE m.user_id = u.id) AS team
              FROM "auth_user" u LEFT JOIN profile p ON p.user_id = u.id`)
    .bind()
    .all<{ id: string; name: string; email: string; first: string | null; last: string | null; created: string | number; roles: string | null; country: string | null; birth_year: number | null; approved_at: number | null; parent: string | null; children: number; team: number }>();
  const words = (opts.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  const rows = results
    .map((r): AccountRow => ({
      id: r.id,
      name: [r.first, r.last].filter(Boolean).join(" ") || r.name,
      email: r.email,
      roles: (r.roles ?? "").split(",").filter(Boolean).sort(),
      country: r.country,
      birthYear: r.birth_year,
      approved: r.approved_at !== null,
      createdAt: typeof r.created === "number" ? r.created : new Date(r.created).getTime() || 0,
      family: r.parent,
      children: r.children,
      team: r.team === 1,
    }))
    .filter((r) => words.every((w) => r.name.toLowerCase().includes(w) || r.email.toLowerCase().includes(w)))
    .filter((r) => !opts.role || (opts.role === "team" ? r.team : r.roles.includes(opts.role)))
    .sort((a, b) => b.createdAt - a.createdAt);
  return { rows: rows.slice(0, opts.limit ?? 200), total: rows.length };
}
