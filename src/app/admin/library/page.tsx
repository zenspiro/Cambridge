import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guard";
import { getEnv } from "@/lib/env";
import { AdminShell, Notice } from "@/components/AdminShell";
import { CellLink, StatusLine } from "@/components/LibraryBits";
import { loadCatalog } from "@/lib/library/catalog";
import { cellMatches, groupCells, searchWords, type Cell } from "@/lib/library/checklist";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryHome({ searchParams }: { searchParams: Promise<{ q?: string; e?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 100);
  const env = await getEnv();
  const { library, qualifications } = await loadCatalog(env.DB);
  const words = searchWords(q);

  // Search across every syllabus.
  const results: { code: string; subject: string; cell: Cell }[] = [];
  if (words.length > 0) {
    for (const qual of qualifications)
      for (const s of qual.subjects)
        for (const y of s.syllabuses) {
          const all = [...y.checklist.versions.flatMap(groupCells), ...y.checklist.sessions.flatMap(groupCells), ...y.checklist.others];
          for (const c of all) if (cellMatches(c, {}, words)) results.push({ code: y.code, subject: `${qual.shortName} ${s.name}`, cell: c });
        }
  }

  return (
    <AdminShell current="/admin/library" title="Library">
      <Notice code={sp.e} messages={{ unknown: "That syllabus is not in the library.", too_big: "That file is too big (25 MB at most)." }} />
      <p className="muted">
        Cambridge source files by qualification and subject, {library.fromYear} to {library.toYear}. Admin only; every
        download is logged. Green means every essential file is in.
      </p>

      <form className="card searchbar" method="get" role="search">
        <label className="sr-only" htmlFor="q">Search the library</label>
        <input className="input" id="q" name="q" type="search" maxLength={100} defaultValue={q}
          placeholder="Search, e.g. mark scheme 2024 paper 4" />
        <button className="btn btn-primary" type="submit">Search</button>
        {q ? <Link className="btn" href="/admin/library">Clear</Link> : null}
      </form>

      {words.length > 0 ? (
        <section className="card stack">
          <h2 className="subtitle">
            {results.length} {results.length === 1 ? "match" : "matches"} for &quot;{q}&quot;
          </h2>
          <ul className="list">
            {results.slice(0, 200).map(({ code, subject, cell }) => (
              <li className="list-row" key={cell.fileName}>
                <span className="doc-main">
                  <span className="mono">{cell.fileName}</span>
                  <Link className="muted link" href={`/admin/library/${code}?q=${encodeURIComponent(cell.fileName)}`}>{subject} ({code})</Link>
                </span>
                <span className="actions">
                  {!cell.doc && !cell.essential ? <span className="muted">extra</span> : null}
                  <CellLink cell={cell} label={cell.doc ? "Download" : "Add"} />
                </span>
              </li>
            ))}
          </ul>
          {results.length > 200 ? <p className="muted">Showing the first 200. Add more words to narrow it down.</p> : null}
        </section>
      ) : (
        qualifications.map((qual) => (
          <section className="stack" key={qual.id}>
            <h2 className="subtitle section-title">{qual.name}</h2>
            {qual.subjects.length === 0 ? (
              <p className="muted card">No subjects yet.</p>
            ) : (
              <div className="cards">
                {qual.subjects.flatMap((s) =>
                  s.syllabuses.map((y) => (
                    <Link className="card card-link" key={y.code} href={`/admin/library/${y.code}`}>
                      <span className="row-between">
                        <strong>{s.name}</strong>
                        <span className="mono muted">{y.code}</span>
                      </span>
                      <StatusLine status={y.checklist.status} compact />
                    </Link>
                  )),
                )}
              </div>
            )}
          </section>
        ))
      )}
    </AdminShell>
  );
}
