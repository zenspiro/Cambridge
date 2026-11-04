// Other Cambridge codes for a library syllabus: 1524 was IGCSE Physics (0625) in the Pakistan-only
// 2021 series. Files keep their own code in their name and sit with the main syllabus. Pure helpers
// plus two small queries; the table is `syllabus_alias` (migration 0015).
import type { Db } from "../db.ts";

export type Alias = { code: string; main_code: string; label: string; from_year: number; to_year: number; sessions: string };

export async function loadAliases(db: Db): Promise<Alias[]> {
  const { results } = await db
    .prepare(`SELECT code, main_code, label, from_year, to_year, sessions FROM syllabus_alias ORDER BY code`)
    .bind()
    .all<Alias>();
  return results;
}

/** The main syllabus code for a code: itself, or the code it stands in for. */
export const mainCodeOf = (aliases: readonly Alias[], code: string): string => aliases.find((a) => a.code === code)?.main_code ?? code;

/** True when the alias covers that year and session (exam sessions only). */
export const aliasCovers = (a: Alias, year: number, session: string): boolean =>
  year >= a.from_year && year <= a.to_year && a.sessions.includes(session);

/** "Pakistan series (1524)". */
export const aliasLabel = (a: Pick<Alias, "code" | "label">): string => `${a.label} (${a.code})`;

/**
 * Learns a code from a cover: "PHYSICS 1524/12 ... May/June 2021" names a library subject by its
 * word ("PHYSICS") with a code the library does not have. Only a 4-digit code that is not a
 * library code, and a subject name that matches exactly one main syllabus, are accepted.
 */
export async function learnAlias(
  db: Db,
  input: { code: string; subjectWord: string; year: number; session: string },
  now = Date.now(),
): Promise<{ ok: true; alias: Alias } | { ok: false; reason: "bad" | "known" | "no_subject" | "many_subjects" }> {
  const code = String(input.code ?? "");
  const word = String(input.subjectWord ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!/^\d{4}$/.test(code) || !word || word.length > 60 || !Number.isInteger(input.year) || input.year < 2000 || input.year > 2099 || !["m", "s", "w"].includes(input.session)) {
    return { ok: false, reason: "bad" };
  }
  if (await db.prepare(`SELECT 1 FROM syllabus WHERE code = ?1`).bind(code).first()) return { ok: false, reason: "known" };
  const had = await db.prepare(`SELECT code, main_code, label, from_year, to_year, sessions FROM syllabus_alias WHERE code = ?1`).bind(code).first<Alias>();
  if (had) {
    // Seen before: the code now also covers this year and session.
    const alias: Alias = {
      ...had, from_year: Math.min(had.from_year, input.year), to_year: Math.max(had.to_year, input.year),
      sessions: had.sessions.includes(input.session) ? had.sessions : had.sessions + input.session,
    };
    await db.prepare(`UPDATE syllabus_alias SET from_year = ?2, to_year = ?3, sessions = ?4 WHERE code = ?1`).bind(code, alias.from_year, alias.to_year, alias.sessions).run();
    return { ok: true, alias };
  }
  const { results } = await db
    .prepare(`SELECT DISTINCT y.code FROM syllabus y JOIN subject s ON s.id = y.subject_id WHERE lower(s.name) = ?1`)
    .bind(word)
    .all<{ code: string }>();
  if (results.length === 0) return { ok: false, reason: "no_subject" };
  if (results.length > 1) return { ok: false, reason: "many_subjects" };
  const alias: Alias = { code, main_code: results[0]!.code, label: "Other series", from_year: input.year, to_year: input.year, sessions: input.session };
  await db
    .prepare(`INSERT INTO syllabus_alias (code, main_code, label, from_year, to_year, sessions, source, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'cover', ?7) ON CONFLICT DO NOTHING`)
    .bind(alias.code, alias.main_code, alias.label, alias.from_year, alias.to_year, alias.sessions, now)
    .run();
  return { ok: true, alias };
}
