// Loads the library hierarchy from the database: qualification > subject > syllabus code >
// versions > checklist with stored files. The admin library and the AI engine's catalog
// endpoint both read through here, so they always see the same structure.
import type { Db } from "../db.ts";
import { getLibrarySettings, type LibrarySettings } from "../settings.ts";
import { buildChecklist, type Checklist, type Status, type StoredDoc, type Version } from "./checklist.ts";
import * as Q from "./queries.ts";
import type { Alias } from "./alias.ts";

export type SyllabusNode = { code: string; title: string; subjectId: string; subjectName: string; checklist: Checklist };
export type SubjectNode = { id: string; name: string; syllabuses: SyllabusNode[] };
export type QualificationNode = { id: string; name: string; shortName: string; subjects: SubjectNode[] };

export async function loadSyllabus(db: Db, code: string, lib?: LibrarySettings): Promise<Checklist | null> {
  if (!/^\d{4}$/.test(code)) return null;
  const settings = lib ?? (await getLibrarySettings(db));
  const [{ results: versions }, { results: stored }, { results: aliases }] = await Promise.all([
    db.prepare(Q.SYLLABI_BY_CODE).bind(code).all<Version>(),
    db.prepare(Q.STORED_FOR_CODE).bind(code).all<StoredDoc>(),
    db.prepare(`SELECT code, main_code, label, from_year, to_year, sessions FROM syllabus_alias WHERE main_code = ?1`).bind(code).all<Alias>(),
  ]);
  if (versions.length === 0) return null;
  return buildChecklist(code, versions, stored, settings, aliases);
}

export async function loadHeader(db: Db, code: string) {
  return db.prepare(Q.SYLLABUS_HEADER).bind(code).first<{
    qualification_id: string; qualification_name: string; short_name: string; subject_id: string; subject_name: string; title: string;
  }>();
}

/** The whole tree, every qualification (even empty ones), with each syllabus's checklist. */
export async function loadCatalog(db: Db): Promise<{ library: LibrarySettings; qualifications: QualificationNode[] }> {
  const lib = await getLibrarySettings(db);
  const [{ results: quals }, { results: codes }] = await Promise.all([
    db.prepare(Q.LIST_QUALIFICATIONS).bind().all<{ id: string; name: string; short_name: string }>(),
    db.prepare(Q.LIST_SYLLABUS_CODES).bind().all<{ qualification_id: string; subject_id: string; subject_name: string; code: string; title: string }>(),
  ]);
  const qualifications: QualificationNode[] = quals.map((q) => ({ id: q.id, name: q.name, shortName: q.short_name, subjects: [] }));
  for (const c of codes) {
    const q = qualifications.find((x) => x.id === c.qualification_id);
    const checklist = await loadSyllabus(db, c.code, lib);
    if (!q || !checklist) continue;
    let s = q.subjects.find((x) => x.id === c.subject_id);
    if (!s) q.subjects.push((s = { id: c.subject_id, name: c.subject_name, syllabuses: [] }));
    s.syllabuses.push({ code: c.code, title: c.title, subjectId: c.subject_id, subjectName: c.subject_name, checklist });
  }
  return { library: lib, qualifications };
}

/** Green when every essential file is in, amber when some are, red when none are. */
export function tone(s: Status): "ok" | "part" | "none" {
  if (s.essentialTotal > 0 && s.essentialHave === s.essentialTotal) return "ok";
  return s.essentialHave > 0 ? "part" : "none";
}

export type SubjectOption = { code: string; label: string; qualification: string };

/** Every syllabus code in the library, for pickers: "IGCSE Physics (0625)". Cheap: one query. */
export async function listSubjects(db: Db): Promise<SubjectOption[]> {
  const { results } = await db
    .prepare(`SELECT q.short_name, s.name AS subject_name, y.code FROM syllabus y JOIN subject s ON s.id = y.subject_id
              JOIN qualification q ON q.id = s.qualification_id GROUP BY q.id, s.id, y.code ORDER BY q.sort_order, s.name, y.code`)
    .bind()
    .all<{ short_name: string; subject_name: string; code: string }>();
  return results.map((r) => ({ code: r.code, label: `${r.short_name} ${r.subject_name} (${r.code})`, qualification: r.short_name }));
}

/** "IGCSE Physics (0625)" for a code, or the code itself when it is not in the list. */
export const subjectLabel = (subjects: SubjectOption[], code: string) => subjects.find((s) => s.code === code)?.label ?? code;

/**
 * Subjects as the file namers need them: code, subject name and qualification, plus other codes
 * for a syllabus (1524, Pakistan series) with `main` set to the syllabus they belong to.
 */
export const KNOWN_SUBJECTS = `
SELECT DISTINCT y.code, s.name, q.short_name AS qualification, NULL AS main FROM syllabus y JOIN subject s ON s.id = y.subject_id
  JOIN qualification q ON q.id = s.qualification_id
UNION
SELECT a.code, s.name, q.short_name, a.main_code FROM syllabus_alias a JOIN syllabus y ON y.code = a.main_code
  JOIN subject s ON s.id = y.subject_id JOIN qualification q ON q.id = s.qualification_id
ORDER BY 1`;

export type KnownSubjectRow = { code: string; name: string; qualification: string; main?: string | null };

export async function knownSubjects(db: Db): Promise<KnownSubjectRow[]> {
  const { results } = await db.prepare(KNOWN_SUBJECTS).bind().all<KnownSubjectRow>();
  return results;
}
