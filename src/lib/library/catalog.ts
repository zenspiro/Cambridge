// Loads the library hierarchy from the database: qualification > subject > syllabus code >
// versions > checklist with stored files. The admin library and the AI engine's catalog
// endpoint both read through here, so they always see the same structure.
import type { Db } from "../db.ts";
import { getLibrarySettings, type LibrarySettings } from "../settings.ts";
import { buildChecklist, type Checklist, type Status, type StoredDoc, type Version } from "./checklist.ts";
import * as Q from "./queries.ts";

export type SyllabusNode = { code: string; title: string; subjectId: string; subjectName: string; checklist: Checklist };
export type SubjectNode = { id: string; name: string; syllabuses: SyllabusNode[] };
export type QualificationNode = { id: string; name: string; shortName: string; subjects: SubjectNode[] };

export async function loadSyllabus(db: Db, code: string, lib?: LibrarySettings): Promise<Checklist | null> {
  if (!/^\d{4}$/.test(code)) return null;
  const settings = lib ?? (await getLibrarySettings(db));
  const [{ results: versions }, { results: stored }] = await Promise.all([
    db.prepare(Q.SYLLABI_BY_CODE).bind(code).all<Version>(),
    db.prepare(Q.STORED_FOR_CODE).bind(code).all<StoredDoc>(),
  ]);
  if (versions.length === 0) return null;
  return buildChecklist(code, versions, stored, settings);
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
