import Link from "next/link";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/team";
import { getEnv } from "@/lib/env";
import { AdminShell } from "@/components/AdminShell";
import { FolderUpload } from "@/components/FolderUpload";
import { acceptChoices } from "@/lib/agent/review";
import { LIBRARY } from "@/lib/config";
import { knownSubjects, listSubjects, loadSyllabus } from "@/lib/library/catalog";
import { describeFile, loadPapers, paperLookup, versionForFile } from "@/lib/library/papers";
import { getLibrarySettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Upload a folder" };

export default async function FolderPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const staff = await requireStaff({ area: "library", level: "edit" });
  const q = await searchParams;
  const env = await getEnv();
  const [allSubjects, known, lib, { results: stored }, { results: allPapers }, { results: allVersions }] = await Promise.all([
    listSubjects(env.DB),
    knownSubjects(env.DB),
    getLibrarySettings(env.DB),
    env.DB.prepare(`SELECT file_name FROM source_document WHERE status = 'stored'`).bind().all<{ file_name: string }>(),
    env.DB.prepare(`SELECT syllabus_id, paper, name FROM syllabus_paper`).bind().all<{ syllabus_id: string; paper: number; name: string }>(),
    env.DB.prepare(`SELECT id, code, valid_from_year, valid_to_year FROM syllabus`).bind().all<{ id: string; code: string; valid_from_year: number; valid_to_year: number }>(),
  ]);
  // A team member picks only from subjects they may edit (owner, 9 Nov 2026).
  const subjects = staff.owner ? allSubjects : allSubjects.filter((s) => can(staff.access, "library", "edit", s.code));
  const code = subjects.some((s) => s.code === q.code) ? q.code! : (subjects.find((s) => s.code === "0625") ?? subjects[0])?.code ?? "";
  const years: number[] = [];
  for (let y = lib.toYear; y >= lib.fromYear; y--) years.push(y);
  const [choices, checklist, { papers }] = await Promise.all([
    acceptChoices(env.DB, { code, years, sessions: ["m", "s", "w", "y"], mode: "download" }),
    loadSyllabus(env.DB, code),
    loadPapers(env.DB, code),
  ]);
  const versions = checklist?.versions.map((g) => g.version) ?? [];
  const look = paperLookup(papers);
  const label = subjects.find((s) => s.code === code)?.label ?? code;

  return (
    <AdminShell
      current="/admin/library/upload"
      title="Upload a folder"
      intro="For a folder downloaded from Google Drive (unzip it first). Every file is worked out from its names, its first page and the AI, and you see the result before anything is uploaded."
      actions={<Link className="btn" href="/admin/library/upload">Upload single files instead</Link>}
    >
      <FolderUpload
        code={code}
        subjectLabel={label}
        subjects={known}
        have={stored.map((s) => s.file_name)}
        fromYear={lib.fromYear}
        toYear={lib.toYear}
        maxFileBytes={LIBRARY.maxFileBytes}
        papers={allPapers}
        versions={allVersions}
        subjectOptions={subjects}
        choices={choices.map((n) => ({ name: n, text: describeFile(n, versionForFile(versions, n), look) }))}
      />
    </AdminShell>
  );
}
