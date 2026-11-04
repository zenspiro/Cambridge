import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
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
  await requireAdmin();
  const q = await searchParams;
  const env = await getEnv();
  const [subjects, known, lib, { results: stored }] = await Promise.all([
    listSubjects(env.DB),
    knownSubjects(env.DB),
    getLibrarySettings(env.DB),
    env.DB.prepare(`SELECT file_name FROM source_document WHERE status = 'stored'`).bind().all<{ file_name: string }>(),
  ]);
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
    <AdminShell current="/admin/library/upload" title="Upload a folder">
      <p className="muted">
        For a folder downloaded from Google Drive (unzip it first). The page keeps the folder names and works out every
        file the way the agent does: from the file and folder names, then from each file&apos;s first page, then with the AI.
        You see the result before anything is uploaded. Files with Cambridge names can also go through{" "}
        <Link className="link" href="/admin/library/upload">the plain upload</Link>.
      </p>
      <form className="card stack" method="get" action="/admin/library/folder">
        <label className="label-inline" htmlFor="folder-code">Main subject of the folder</label>
        <div className="actions">
          <select className="input review-select" id="folder-code" name="code" defaultValue={code}>
            {subjects.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </select>
          <button className="btn btn-small" type="submit">Choose</button>
        </div>
        <p className="muted">Files of other subjects in the folder are still recognised and stored; the AI and the list of missing files use this subject.</p>
      </form>
      <FolderUpload
        code={code}
        subjectLabel={label}
        subjects={known}
        have={stored.map((s) => s.file_name)}
        fromYear={lib.fromYear}
        toYear={lib.toYear}
        maxFileBytes={LIBRARY.maxFileBytes}
        choices={choices.map((n) => ({ name: n, text: describeFile(n, versionForFile(versions, n), look) }))}
      />
    </AdminShell>
  );
}
